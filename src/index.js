import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";

import { handleInteraction } from "./commands.js";
import { ConfigError, getConfig } from "./config.js";
import { ItemStore } from "./itemStore.js";
import { logger } from "./logger.js";
import { MabinogiClient } from "./mabinogiApi.js";
import { PriceMonitor } from "./monitor.js";
import { registerCommandsForGuild, registerCommandsWithClient } from "./registerCommands.js";
import { SettingsStore } from "./settingsStore.js";

async function main() {
  const config = getConfig();
  const itemStore = new ItemStore({ filePath: config.itemsFile, initialItems: config.initialItems });
  await itemStore.load();
  const settingsStore = new SettingsStore({
    filePath: config.settingsFile,
    initialSettings: config.discordChannelId ? { alertChannelId: config.discordChannelId } : {},
  });
  await settingsStore.load();

  const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });
  const mabinogiClient = new MabinogiClient({
    apiKey: config.mabinogiApiKey,
    endpoint: config.nexonApiEndpoint,
    timeoutMs: config.requestTimeoutMs,
  });

  const resolveAlertChannel = async (userId) => {
    const alertChannelId = settingsStore.getAlertChannelId(userId);
    if (!alertChannelId) {
      return null;
    }

    const cached = discordClient.channels.cache.get(alertChannelId);
    return cached ?? discordClient.channels.fetch(alertChannelId);
  };

  const monitor = new PriceMonitor({
    mabinogiClient,
    itemStore,
    settingsStore,
    resolveChannel: resolveAlertChannel,
    intervalMs: settingsStore.getCheckIntervalMs(config.checkIntervalMs),
    defaultAlertDiscountPercent: Math.round(config.alertDiscountThreshold * 100),
    cooldownMs: config.alertCooldownMs,
    logger,
  });

  discordClient.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Logged in as ${readyClient.user.tag}.`);

    if (config.autoDeployCommands) {
      try {
        await registerCommandsWithClient(readyClient, config, logger);
      } catch (error) {
        logger.error("Automatic slash command registration failed:", error);
      }
    }

    monitor.start();
  });

  discordClient.on(Events.GuildCreate, async (guild) => {
    if (!config.autoDeployCommands) {
      return;
    }

    try {
      logger.info(`Discord slash commands registering (new guild ${guild.id})...`);
      await registerCommandsForGuild(guild, logger);
    } catch (error) {
      logger.error(`Slash command registration failed for new guild ${guild.id}:`, error);
    }
  });

  discordClient.on(Events.InteractionCreate, async (interaction) => {
    try {
      await handleInteraction(interaction, {
        config,
        itemStore,
        settingsStore,
        mabinogiClient,
        monitor,
      });
    } catch (error) {
      logger.error("Interaction handling failed:", error);

      const payload = { content: "명령 처리 중 오류가 발생했습니다. 로그를 확인해 주세요.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  });

  const shutdown = () => {
    logger.info("Shutdown requested.");
    monitor.stop();
    discordClient.destroy();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await discordClient.login(config.discordToken);
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    logger.error(error.message);
  } else {
    logger.error(error);
  }
  process.exitCode = 1;
}
