const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config');
const { createDb } = require('./db');
const { makeLogger } = require('./logger');
const { createFlyService } = require('./services/fly');
const { createAnnounceService } = require('./services/announce');
const { createVoiceStay } = require('./services/voiceStay');
const { createTypingService } = require('./services/typing');
const { createLogAdmin } = require('./services/logAdmin');
const { loadCommands } = require('./loader');

const cfg = loadConfig();
const db = createDb(cfg.databasePath);

const before = db.getSettings();
db.setSettings({ guild_id: cfg.guildId, authorized_role_id: cfg.authorizedRoleId, setup_completed: true });
if (before.authorized_role_id !== cfg.authorizedRoleId) db.logAccessChange('config-file', before.authorized_role_id, cfg.authorizedRoleId);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const log = makeLogger(client, db);
const fly = createFlyService({ db, client, log });
const announce = createAnnounceService({ db, client, log, dataDir: path.dirname(path.resolve(cfg.databasePath)) });
const voiceStay = createVoiceStay({ db, client, log });
const typing = createTypingService({ db, client, log });
const logAdmin = createLogAdmin({ db, client, log });
const ctx = { db, client, fly, announce, voiceStay, typing, logAdmin, log, commands: loadCommands(), envGuildId: cfg.guildId, defaultTimezone: cfg.defaultTimezone };

for (const file of fs.readdirSync(path.join(__dirname, 'events')).filter((f) => f.endsWith('.js'))) {
  const ev = require(path.join(__dirname, 'events', file));
  client[ev.once ? 'once' : 'on'](ev.name, (...args) => ev.execute(ctx, ...args));
}

process.on('unhandledRejection', (e) => console.error('Unhandled error:', e));
client.login(cfg.token);
