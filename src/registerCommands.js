import { REST, Routes } from "discord.js";

import { applicationCommands } from "./commands.js";

export async function registerCommands(config, log) {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const route = config.discordGuildId
    ? Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId)
    : Routes.applicationCommands(config.discordClientId);

  const scope = config.discordGuildId ? `guild ${config.discordGuildId}` : "global";
  log.info(`Discord slash commands registering (${scope})...`);
  await rest.put(route, { body: applicationCommands });
  log.info(`Discord slash commands registered (${applicationCommands.length} commands, ${scope}).`);
}

