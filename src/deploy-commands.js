import { ConfigError, getConfig } from "./config.js";
import { logger } from "./logger.js";
import { registerCommands } from "./registerCommands.js";

try {
  const config = getConfig({ requireClientId: true });
  await registerCommands(config, logger);
} catch (error) {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error(error);
  }
  process.exitCode = 1;
}

