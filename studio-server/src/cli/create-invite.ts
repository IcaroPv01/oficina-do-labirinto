import { loadConfig } from "../config.js";
import { parseWorkspaceRole } from "../contracts.js";
import { StudioDatabase } from "../database.js";

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const config = loadConfig();
const role = parseWorkspaceRole(argument("role") ?? "viewer");
const hoursRaw = argument("hours") ?? String(config.inviteTtlMs / 3_600_000);
const hours = Number(hoursRaw);
if (!Number.isSafeInteger(hours) || hours < 1 || hours > 24 * 30) {
  throw new Error("--hours deve ser um inteiro entre 1 e 720");
}

const database = new StudioDatabase(config.databasePath);
try {
  const created = database.createInvite(role, null, hours * 3_600_000);
  // The token is intentionally printed once for the local operator. It is stored only as a hash.
  process.stdout.write(
    `${JSON.stringify({ invite: created.value, token: created.token }, null, 2)}\n`,
  );
} finally {
  database.close();
}
