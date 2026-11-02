
require('dotenv').config();

function loadConfig() {
  const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'AUTHORIZED_ROLE_ID'];
  const missing = required.filter((k) => !String(process.env[k] ?? '').trim());
  if (missing.length) {
    console.error(`Missing values in your .env file: ${missing.join(', ')}`);
    process.exit(1);
  }
  const clean = (k) => String(process.env[k]).trim();

  for (const k of ['CLIENT_ID', 'GUILD_ID', 'AUTHORIZED_ROLE_ID']) {
    if (!/^\d{15,25}$/.test(clean(k))) {
      console.error(`${k} in your .env file must be just numbers (no spaces, no quotes, no @).`);
      process.exit(1);
    }
  }
  return {
    token: clean('DISCORD_TOKEN'), clientId: clean('CLIENT_ID'), guildId: clean('GUILD_ID'),
    authorizedRoleId: clean('AUTHORIZED_ROLE_ID'),
    databasePath: process.env.DATABASE_PATH || './data/urahara.sqlite',
    defaultTimezone: process.env.DISPLAY_TIMEZONE || 'UTC',
  };
}
module.exports = { loadConfig };
