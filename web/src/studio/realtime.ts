import type { StudioTransport } from "./api-client";

export type StudioRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export interface StudioRealtimeMessage {
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface StudioRealtimeOptions {
  readonly transport: StudioTransport;
  readonly projectId: string;
  readonly onConnectionState: (state: StudioRealtimeConnectionState) => void;
  readonly onMessage: (message: StudioRealtimeMessage) => void;
  readonly webSocketFactory?: (url: string) => WebSocket;
  readonly windowObject?: Window;
}

export interface StudioRealtimeHandle {
  sendPresence(
    state: "idle" | "editing" | "testing",
    entity?: string | null,
  ): void;
  destroy(): void;
}

export function createStudioRealtime(
  options: StudioRealtimeOptions,
): StudioRealtimeHandle {
  const windowObject = options.windowObject ?? window;
  const createSocket =
    options.webSocketFactory ?? ((url: string) => new WebSocket(url));
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let destroyed = false;

  const clearReconnect = (): void => {
    if (reconnectTimer !== null) {
      windowObject.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = (): void => {
    if (destroyed || !windowObject.navigator.onLine) {
      options.onConnectionState("offline");
      return;
    }
    clearReconnect();
    options.onConnectionState(
      reconnectAttempt === 0 ? "connecting" : "reconnecting",
    );
    const nextSocket = createSocket(
      createStudioWebSocketUrl(options.transport.baseUrl, options.projectId),
    );
    socket = nextSocket;
    nextSocket.addEventListener("open", () => {
      reconnectAttempt = 0;
      options.onConnectionState("connected");
    });
    nextSocket.addEventListener("message", (event) => {
      const message = parseStudioRealtimeMessage(event.data);
      if (message) {
        options.onMessage(message);
      }
    });
    nextSocket.addEventListener("close", () => {
      if (socket === nextSocket) {
        socket = null;
      }
      scheduleReconnect();
    });
    nextSocket.addEventListener("error", () => {
      nextSocket.close();
    });
  };

  const scheduleReconnect = (): void => {
    if (destroyed || reconnectTimer !== null) {
      return;
    }
    if (!windowObject.navigator.onLine) {
      options.onConnectionState("offline");
      return;
    }
    options.onConnectionState("reconnecting");
    const delay = studioReconnectDelay(reconnectAttempt++);
    reconnectTimer = windowObject.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const onOnline = (): void => {
    reconnectAttempt = 0;
    connect();
  };
  const onOffline = (): void => {
    clearReconnect();
    options.onConnectionState("offline");
    socket?.close();
  };
  windowObject.addEventListener("online", onOnline);
  windowObject.addEventListener("offline", onOffline);
  connect();

  return {
    sendPresence(state, entity = null) {
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: "presence.update",
          state,
          entity,
        }),
      );
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      clearReconnect();
      windowObject.removeEventListener("online", onOnline);
      windowObject.removeEventListener("offline", onOffline);
      socket?.close(1000, "Estúdio fechado");
      socket = null;
    },
  };
}

export function createStudioWebSocketUrl(
  baseUrl: URL,
  projectId: string,
): string {
  const url = new URL("ws", ensureTrailingSlash(baseUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("projectId", projectId);
  return url.toString();
}

export function studioReconnectDelay(attempt: number): number {
  const normalized = Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(1_000 * 2 ** normalized, 30_000);
}

export function parseStudioRealtimeMessage(
  value: unknown,
): StudioRealtimeMessage | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const type = (parsed as { readonly type?: unknown }).type;
    return typeof type === "string"
      ? (parsed as StudioRealtimeMessage)
      : null;
  } catch {
    return null;
  }
}

function ensureTrailingSlash(url: URL): URL {
  const normalized = new URL(url);
  normalized.pathname = `${normalized.pathname.replace(/\/+$/, "")}/`;
  normalized.search = "";
  normalized.hash = "";
  return normalized;
}
