import { createHash } from "node:crypto";

/** RFC 8785-compatible canonicalization for values that have already crossed JSON.parse. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON accepts only finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
      .join(",")}}`;
  }
  throw new TypeError("Value is not representable as JSON");
}

export function digestCanonicalJson(value: unknown): { canonical: string; digest: string; bytes: number } {
  const canonical = canonicalJson(value);
  const bytes = Buffer.byteLength(canonical, "utf8");
  return {
    canonical,
    digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
    bytes,
  };
}
