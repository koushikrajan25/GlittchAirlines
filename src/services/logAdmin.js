const { PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000 - 60_000; 
const MAX_SCAN = 1000;                                

function createLogAdmin({ db, client, log }) {
  async function clearLog({ guild, moderatorId, amount }) {
    await assertAuthorized(guild, moderatorId, db);
    const id = db.getSettings().log_channel_id;
    if (!id) throw new UserError('No log channel is set. Use `/fly-config log-channel` first.');
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel || !channel.isTextBased()) throw new UserError('The log channel no longer exists. Set it again with `/fly-config log-channel`.');
    const me = await guild.members.fetchMe();
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.ReadMessageHistory)) {
      throw new UserError('I need **View Channel** and **Read Message History** in the log channel.');
    }

    const mine = [];
    let before; let scanned = 0;
    while (mine.length < amount && scanned < MAX_SCAN) {
      const page = await channel.messages.fetch({ limit: 100, before });
      if (!page.size) break;
      scanned += page.size;
      for (const m of page.values()) {
        const isLogEmbed = m.author.id === client.user.id && m.embeds.length > 0 && m.attachments.size === 0 && !m.pinned;
        if (isLogEmbed && mine.length < amount) mine.push(m);
      }
      before = page.last().id;
    }

    const cutoff = Date.now() - TWO_WEEKS;
    const recent = mine.filter((m) => m.createdTimestamp > cutoff);
    const old = mine.filter((m) => m.createdTimestamp <= cutoff);
    const canBulk = perms.has(PermissionFlagsBits.ManageMessages);
    let deleted = 0;
    const oneByOne = canBulk ? old : [...recent, ...old];
    if (canBulk) {
      for (let i = 0; i < recent.length; i += 100) {
        const chunk = recent.slice(i, i + 100);
        if (chunk.length === 1) oneByOne.push(chunk[0]);
        else deleted += (await channel.bulkDelete(chunk, true).catch(() => null))?.size ?? 0;
      }
    }
    for (const m of oneByOne) { if (await m.delete().then(() => true).catch(() => false)) deleted++; }

    db.audit(moderatorId, 'log_cleared', { requested: amount, found: mine.length, deleted });
    await log(brandEmbed('LOG CLEARED').addFields(
      { name: 'By', value: `<@${moderatorId}>`, inline: true }, { name: 'Embeds deleted', value: String(deleted), inline: true }));
    return { found: mine.length, deleted };
  }
  return { clearLog };
}

module.exports = { createLogAdmin };
