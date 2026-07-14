import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { createStudioServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createStudioServer(config);
  const address = await server.listen();
  logger.info("studio_server_started", {
    host: address.host,
    port: address.port,
    corsOriginCount: config.corsOrigins.size,
    aiConfigured: Boolean(config.verbooApiKey),
    database: config.databasePath === ":memory:" ? ":memory:" : "configured",
  });

  let stopping = false;
  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("studio_server_stopping", { signal });
    await server.close();
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error("studio_server_start_failed", error);
  process.exitCode = 1;
});
