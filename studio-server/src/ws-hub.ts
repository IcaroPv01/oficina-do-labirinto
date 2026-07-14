import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { assertCsrfToken, authenticate } from "./auth.js";
import type { StudioConfig } from "./config.js";
import type {
  ChatMessageView,
  RevisionView,
  SessionPrincipal,
  StudioDatabase,
} from "./database.js";
import type { ChangeSet } from "./contracts.js";
import { HttpError } from "./errors.js";
import { logger } from "./logger.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { opaqueId, record, stringField } from "./validation.js";

type PresenceState = "idle" | "editing" | "testing";

interface ClientState {
  readonly id: string;
  readonly socket: WebSocket;
  readonly projectId: string;
  readonly principal: SessionPrincipal;
  presence: PresenceState;
  entity: string | null;
  alive: boolean;
}

export class StudioWebSocketHub {
  private readonly server: WebSocketServer;
  private readonly clients = new Set<ClientState>();
  private readonly messageRate = new FixedWindowRateLimiter(40, 60_000, "Muitas mensagens no WebSocket");
  private readonly heartbeat: NodeJS.Timeout;

  constructor(
    httpServer: HttpServer,
    private readonly database: StudioDatabase,
    private readonly config: StudioConfig,
  ) {
    this.server = new WebSocketServer({ noServer: true, maxPayload: config.maxWsBytes, clientTracking: false });
    httpServer.on("upgrade", (request, socket, head) => this.upgrade(request, socket, head));
    this.heartbeat = setInterval(() => this.ping(), 30_000);
    this.heartbeat.unref();
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.socket.close(1001, "Servidor encerrado");
    this.server.close();
  }

  broadcastRevision(projectId: string, revision: RevisionView): void {
    this.broadcast(projectId, { type: "project.revision.created", revision });
  }

  broadcastChat(projectId: string, message: ChatMessageView): void {
    this.broadcast(projectId, { type: "chat.created", message });
  }

  broadcastChangeSet(projectId: string, changeSet: ChangeSet, event: string): void {
    this.broadcast(projectId, { type: "change-set.updated", event, changeSet });
  }

  private upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    try {
      const url = new URL(request.url ?? "/", "http://studio.invalid");
      if (url.pathname !== "/ws") {
        this.rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      const origin = request.headers.origin;
      if (!origin || !this.config.corsOrigins.has(origin)) {
        this.rejectUpgrade(socket, 403, "Forbidden");
        return;
      }
      const principal = authenticate(request, this.database, this.config);
      if (!principal) {
        this.rejectUpgrade(socket, 401, "Unauthorized");
        return;
      }
      const projectId = opaqueId(url.searchParams.get("projectId") ?? "", "projectId");
      if (!this.database.getProject(projectId)) {
        this.rejectUpgrade(socket, 404, "Not Found");
        return;
      }
      this.server.handleUpgrade(request, socket, head, (webSocket) => {
        this.accept(webSocket, projectId, principal);
      });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      this.rejectUpgrade(socket, status, "Bad Request");
    }
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  }

  private accept(socket: WebSocket, projectId: string, principal: SessionPrincipal): void {
    const client: ClientState = {
      id: randomUUID(),
      socket,
      projectId,
      principal,
      presence: "idle",
      entity: null,
      alive: true,
    };
    this.clients.add(client);
    socket.on("pong", () => {
      client.alive = true;
    });
    socket.on("message", (data, isBinary) => this.onMessage(client, data, isBinary));
    socket.on("close", () => this.remove(client));
    socket.on("error", (error) => {
      logger.warn("websocket_error", { userId: principal.user.id, error });
    });

    this.send(client, {
      type: "ready",
      clientId: client.id,
      user: principal.user,
      presence: this.presenceSnapshot(projectId),
    });
    this.broadcast(
      projectId,
      { type: "presence.join", presence: this.publicPresence(client) },
      client.id,
    );
  }

  private onMessage(client: ClientState, data: RawData, isBinary: boolean): void {
    try {
      this.messageRate.assertAllowed(`${client.principal.user.id}:ws`);
      if (isBinary) throw new HttpError(400, "binary_not_supported", "Mensagens binárias não são aceitas");
      const payload = record(JSON.parse(data.toString()) as unknown);
      const type = stringField(payload, "type", { max: 50 });
      if (type === "chat.send") {
        assertCsrfToken(payload.csrfToken, client.principal);
        const body = stringField(payload, "body", { max: this.config.maxChatChars });
        const message = this.database.addChatMessage(client.projectId, client.principal.user, body);
        this.broadcastChat(client.projectId, message);
        return;
      }
      if (type === "presence.update") {
        const state = stringField(payload, "state", { max: 20 });
        if (state !== "idle" && state !== "editing" && state !== "testing") {
          throw new HttpError(400, "invalid_presence", "Estado de presença inválido");
        }
        const entity = payload.entity;
        if (entity !== undefined && entity !== null && (typeof entity !== "string" || entity.length > 200)) {
          throw new HttpError(400, "invalid_presence", "Entidade de presença inválida");
        }
        client.presence = state;
        client.entity = typeof entity === "string" ? entity : null;
        this.broadcast(client.projectId, { type: "presence.update", presence: this.publicPresence(client) });
        return;
      }
      throw new HttpError(400, "unknown_ws_message", "Tipo de mensagem desconhecido");
    } catch (error) {
      const httpError = error instanceof HttpError ? error : new HttpError(400, "invalid_ws_message", "Mensagem inválida");
      this.send(client, { type: "error", error: { code: httpError.code, message: httpError.message } });
    }
  }

  private remove(client: ClientState): void {
    if (!this.clients.delete(client)) return;
    this.broadcast(client.projectId, { type: "presence.leave", clientId: client.id });
  }

  private publicPresence(client: ClientState): Record<string, unknown> {
    return {
      clientId: client.id,
      user: client.principal.user,
      state: client.presence,
      entity: client.entity,
    };
  }

  private presenceSnapshot(projectId: string): Record<string, unknown>[] {
    return [...this.clients]
      .filter((client) => client.projectId === projectId)
      .map((client) => this.publicPresence(client));
  }

  private broadcast(projectId: string, payload: Record<string, unknown>, excludeClientId?: string): void {
    for (const client of this.clients) {
      if (client.projectId === projectId && client.id !== excludeClientId) this.send(client, payload);
    }
  }

  private send(client: ClientState, payload: Record<string, unknown>): void {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(payload));
  }

  private ping(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.socket.terminate();
        this.remove(client);
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
  }
}
