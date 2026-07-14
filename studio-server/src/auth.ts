import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { StudioConfig } from "./config.js";
import type { NewSession, SessionPrincipal, StudioDatabase } from "./database.js";
import { HttpError } from "./errors.js";

export function parseCookies(header: string | undefined): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    const name = pair.slice(0, index).trim();
    const rawValue = pair.slice(index + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(rawValue));
    } catch {
      // Ignore malformed cookies instead of reflecting their contents.
    }
  }
  return cookies;
}

export function sessionTokenFromRequest(request: IncomingMessage, config: StudioConfig): string | null {
  return parseCookies(request.headers.cookie).get(config.cookieName) ?? null;
}

export function authenticate(
  request: IncomingMessage,
  database: StudioDatabase,
  config: StudioConfig,
): SessionPrincipal | null {
  const token = sessionTokenFromRequest(request, config);
  return token ? database.getSession(token) : null;
}

export function requireSession(
  request: IncomingMessage,
  database: StudioDatabase,
  config: StudioConfig,
): SessionPrincipal {
  const principal = authenticate(request, database, config);
  if (!principal) throw new HttpError(401, "authentication_required", "Autenticação necessária");
  return principal;
}

export function requireCsrf(request: IncomingMessage, principal: SessionPrincipal): void {
  const supplied = request.headers["x-studio-csrf"];
  if (typeof supplied !== "string" || !safeEqual(supplied, principal.csrfToken)) {
    throw new HttpError(403, "csrf_failed", "Token CSRF ausente ou inválido");
  }
}

export function assertCsrfToken(supplied: unknown, principal: SessionPrincipal): void {
  if (typeof supplied !== "string" || !safeEqual(supplied, principal.csrfToken)) {
    throw new HttpError(403, "csrf_failed", "Token CSRF ausente ou inválido");
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function setSessionCookie(response: ServerResponse, session: NewSession, config: StudioConfig): void {
  const attributes = [
    `${config.cookieName}=${encodeURIComponent(session.sessionToken)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.cookieSameSite[0]?.toUpperCase()}${config.cookieSameSite.slice(1)}`,
    `Max-Age=${Math.floor(config.sessionTtlMs / 1_000)}`,
  ];
  if (config.cookieSecure) attributes.push("Secure");
  if (config.cookieSameSite === "none") attributes.push("Partitioned");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

export function clearSessionCookie(response: ServerResponse, config: StudioConfig): void {
  const attributes = [
    `${config.cookieName}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${config.cookieSameSite[0]?.toUpperCase()}${config.cookieSameSite.slice(1)}`,
    "Max-Age=0",
  ];
  if (config.cookieSecure) attributes.push("Secure");
  if (config.cookieSameSite === "none") attributes.push("Partitioned");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

export function isLoopbackSocket(socket: Socket): boolean {
  const address = socket.remoteAddress?.toLowerCase();
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
