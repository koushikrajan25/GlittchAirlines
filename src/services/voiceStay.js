const { ChannelType } = require('discord.js');
const { joinVoiceChannel, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');

function createVoiceStay({ db, client, log }) {
  let busy = false;

  async function connect(guild, channelId) {
    const old = getVoiceConnection(guild.id);
    if (old && old.state.status !== VoiceConnectionStatus.Destroyed) old.destroy();

    const connection = joinVoiceChannel({
      channelId, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true, selfMute: true,   
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      }
    });
    connection.on('error', (e) => console.warn('Voice connection error:', e.message));
    try { await entersState(connection, VoiceConnectionStatus.Ready, 20_000); }
    catch (e) {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
      throw e;
    }
  }

  async function ensure() {
    if (busy) return;
    busy = true;
    try {
      const s = db.getSettings();
      if (!s.stay_vc_id || !s.guild_id) return;
      const guild = await client.guilds.fetch(s.guild_id).catch(() => null);
      if (!guild) return;
      const conn = getVoiceConnection(guild.id);
      const status = conn?.state.status;
      const inRightChannel = guild.voiceStates.cache.get(client.user.id)?.channelId === s.stay_vc_id;
      if (status === VoiceConnectionStatus.Ready && inRightChannel) return;
      if (status === VoiceConnectionStatus.Signalling || status === VoiceConnectionStatus.Connecting) return; // still connecting
      await connect(guild, s.stay_vc_id);
    } catch (err) {
      console.warn('24/7 voice: could not rejoin, will retry:', err.message);
    } finally { busy = false; }
  }

  async function set({ guild, moderatorId, channelId }) {
    await assertAuthorized(guild, moderatorId, db);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) throw new UserError('Please pick a normal voice channel.');
    if (!channel.joinable) throw new UserError('I cannot join that channel. Give me **View Channel** and **Connect** there, and make sure it is not full.');
    try { await connect(guild, channel.id); }
    catch (err) { throw new UserError(`I could not join that channel: ${err.message}`); }
    const old = db.getSettings().stay_vc_id;
    db.setSetting('stay_vc_id', channel.id);
    db.audit(moderatorId, '247_set', { old, new: channel.id });
    await log(brandEmbed('24/7 VOICE ENABLED').addFields(
      { name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'By', value: `<@${moderatorId}>`, inline: true }));
    return channel;
  }

  async function off({ guild, moderatorId }) {
    await assertAuthorized(guild, moderatorId, db);
    const old = db.getSettings().stay_vc_id;
    if (!old) throw new UserError('24/7 voice is not turned on.');
    db.setSetting('stay_vc_id', null);
    const conn = getVoiceConnection(guild.id);
    if (conn && conn.state.status !== VoiceConnectionStatus.Destroyed) conn.destroy();
    db.audit(moderatorId, '247_off', { old });
    await log(brandEmbed('24/7 VOICE DISABLED').addFields(
      { name: 'Was in', value: `<#${old}>`, inline: true }, { name: 'By', value: `<@${moderatorId}>`, inline: true }));
  }

  return { ensure, set, off };
}

module.exports = { createVoiceStay };
