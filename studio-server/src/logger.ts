import { asError } from "./errors.js";

type LogFields = Readonly<Record<string, unknown>>;
type LogLevel = "info" | "warn" | "error";

const secretKey = /(authorization|cookie|token|secret|password|api[-_]?key|set-cookie)/i;

function redact(value: unknown, key = "", depth = 0): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (depth > 5) return "[MAX_DEPTH]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => redact(item, "", depth + 1));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [childKey, redact(childValue, childKey, depth + 1)]),
    );
  }
  return value;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const safeFields = redact(fields) as Record<string, unknown>;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...safeFields,
  });
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info(message: string, fields: LogFields = {}): void {
    write("info", message, fields);
  },
  warn(message: string, fields: LogFields = {}): void {
    write("warn", message, fields);
  },
  error(message: string, error: unknown, fields: LogFields = {}): void {
    write("error", message, { ...fields, error: asError(error) });
  },
};
