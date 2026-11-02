const { PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');

function createTypingService({ db, client, log }) {
  let warned = false;

  async function tick() {
    const id = db.getSettings().typing_channel_id;
    if (!id) return;
    try {
      const channel = await client.channels.fetch(id);
      await channel.sendTyping();
      warned = false;
    } catch (err) {
      if (!warned) { console.warn('Typing indicator failed (will keep trying):', err.message); warned = true; }
    }
  }

  async function set({ guild, moderatorId, channelId }) {
    await assertAuthorized(guild, moderatorId, db);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isVoiceBased()) throw new UserError('Please pick a text channel.');
    const me = await guild.members.fetchMe();
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.SendMessages)) {
      throw new UserError('I need **View Channel** and **Send Messages** in that channel to show "is typing". (I will never send a message there.)');
    }
    const old = db.getSettings().typing_channel_id;
    db.setSetting('typing_channel_id', channel.id);
    db.audit(moderatorId, 'typing_set', { old, new: channel.id });
    await log(brandEmbed('TYPING CHANNEL SET').addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'By', value: `<@${moderatorId}>`, inline: true }));
    tick();
    return channel;
  }

  async function off({ guild, moderatorId }) {
    await assertAuthorized(guild, moderatorId, db);
    const old = db.getSettings().typing_channel_id;
    if (!old) throw new UserError('The typing indicator is not turned on.');
    db.setSetting('typing_channel_id', null);
    db.audit(moderatorId, 'typing_off', { old });
    await log(brandEmbed('TYPING INDICATOR DISABLED').addFields(
      { name: 'Was in', value: `<#${old}>`, inline: true }, { name: 'By', value: `<@${moderatorId}>`, inline: true }));
  }

  return { tick, set, off };
}

module.exports = { createTypingService };
