
const { brandEmbed } = require('../embeds');

async function changeSetting({ db, log, userId, key, value, label, shown }) {
  const old = db.getSettings()[key];
  db.setSetting(key, value);
  db.audit(userId, 'config_change', { key, old, value });
  await log(brandEmbed('SETTINGS CHANGED').addFields(
    { name: 'Setting', value: label, inline: true },
    { name: 'New value', value: String(shown).slice(0, 1000), inline: true },
    { name: 'By', value: `<@${userId}>`, inline: true }));
}
module.exports = { changeSetting };
