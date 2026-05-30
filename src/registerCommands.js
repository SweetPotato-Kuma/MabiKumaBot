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

export async function registerCommandsWithClient(client, config, log) {
  const scope = config.discordGuildId ? `guild ${config.discordGuildId}` : "global";
  log.info(`Discord slash commands registering (${scope})...`);

  if (config.discordGuildId) {
    const guild = await client.guilds.fetch(config.discordGuildId);
    await guild.commands.set(applicationCommands);
  } else {
    await client.application.commands.set(applicationCommands);
  }

  log.info(`Discord slash commands registered (${applicationCommands.length} commands, ${scope}).`);
}
