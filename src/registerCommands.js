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
  if (config.discordGuildId) {
    const scope = `guild ${config.discordGuildId}`;
    log.info(`Discord slash commands registering (${scope})...`);
    const guild = await client.guilds.fetch(config.discordGuildId);
    await guild.commands.set(applicationCommands);
    log.info(`Discord slash commands registered (${applicationCommands.length} commands, ${scope}).`);
    await client.application.commands.set([]);
    log.info("Discord global slash commands cleared.");
    return;
  }

  const guilds = await client.guilds.fetch();
  if (guilds.size > 0) {
    log.info(`Discord slash commands registering (${guilds.size} guilds)...`);
    for (const [guildId] of guilds) {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(applicationCommands);
      log.info(`Discord slash commands registered (${applicationCommands.length} commands, guild ${guildId}).`);
    }
    await client.application.commands.set([]);
    log.info("Discord global slash commands cleared.");
  } else {
    log.info("Discord slash commands registering (global)...");
    await client.application.commands.set(applicationCommands);
    log.info(`Discord slash commands registered (${applicationCommands.length} commands, global).`);
  }
}
