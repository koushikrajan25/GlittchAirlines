const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./config');
const { loadCommands } = require('./loader');

const cfg = loadConfig();
const body = [...loadCommands().values()].map((c) => c.data.toJSON());
new REST({ version: '10' }).setToken(cfg.token)
  .put(Routes.applicationGuildCommands(cfg.clientId, cfg.guildId), { body })
  .then(() => console.log(`Registered ${body.length} commands.`))
  .catch((e) => { console.error('Failed to register commands:', e.message); process.exit(1); });
