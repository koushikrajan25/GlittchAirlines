const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed } = require('../embeds');
const { formatDuration, formatTime, MIN } = require('../utils');

const MAX_FAILURES = 3;       
const MAX_ACTIVE = 10;        
const MIN_INTERVAL = 2, MAX_INTERVAL = 300;   // seconds
const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

function nextTarget(channelIds, startIdx, currentChannelId) {
  const n = channelIds.length;
  for (let k = 0; k < n; k++) {
    const i = (startIdx + k) % n;
    if (channelIds[i] !== currentChannelId) return { channelId: channelIds[i], idx: (i + 1) % n };
  }
  return null;
}

function createFlyService({ db, client, log }) {
  let sweeping = false;

  async function checkChannel(guild, me, id) {
    const ch = await guild.channels.fetch(id).catch(() => null);
    if (!ch || !VOICE_TYPES.includes(ch.type)) throw new UserError('That is not a voice channel.');
    const p = ch.permissionsFor(me);
    if (!p?.has(PermissionFlagsBits.ViewChannel) || !p.has(PermissionFlagsBits.Connect) || !p.has(PermissionFlagsBits.MoveMembers)) {
      throw new UserError(`I need **View Channel**, **Connect** and **Move Members** in <#${id}>.`);
    }
    return ch;
  }

  async function liveChannels(guild) {
    const ids = db.getSettings().fly_channel_ids;
    const live = [];
    for (const id of ids) {
      const ch = await guild.channels.fetch(id).catch(() => null);
      if (ch && VOICE_TYPES.includes(ch.type)) live.push(ch);
    }
    if (live.length !== ids.length) db.setSetting('fly_channel_ids', live.map((c) => c.id));
    return live;
  }

  function flyEmbed(title, fly, note) {
    const tz = db.getSettings().timezone;
    const active = fly.status === 'active';
    const e = brandEmbed(title).addFields(
      { name: 'Member', value: `<@${fly.user_id}>`, inline: true },
      { name: 'Started by', value: `<@${fly.moderator_id}>`, inline: true },
      { name: 'Every', value: `${Math.round(fly.interval_ms / 1000)}s`, inline: true },
      { name: 'Channels', value: JSON.parse(fly.channels).map((c) => `<#${c}>`).join(' → ') },
      { name: 'Moves so far', value: String(fly.moves), inline: true },
      { name: active ? 'Ends' : 'Result', value: active ? `${formatTime(fly.expires_at, tz)} (<t:${Math.floor(fly.expires_at / 1000)}:R>)` : fly.status, inline: true },
    );
    if (note) e.addFields({ name: 'Note', value: String(note).slice(0, 500) });
    return e;
  }


  async function startFly({ guild, moderatorId, targetUserId, durationMs, intervalSec }) {
    await assertAuthorized(guild, moderatorId, db);
    const s = db.getSettings();

    durationMs ??= s.default_duration_ms;
    intervalSec ??= s.default_interval_seconds;
    if (durationMs < MIN || durationMs > s.max_duration_ms) throw new UserError(`Duration must be between 1m and ${formatDuration(s.max_duration_ms)}.`);
    if (!Number.isInteger(intervalSec) || intervalSec < MIN_INTERVAL || intervalSec > MAX_INTERVAL) throw new UserError(`Interval must be ${MIN_INTERVAL}-${MAX_INTERVAL} seconds.`);
    if (targetUserId === client.user.id) throw new UserError('I cannot fly myself.');
    if (targetUserId === guild.ownerId) throw new UserError('The server owner cannot be flown.');
    if (db.getActiveFly(targetUserId)) throw new UserError('That member is already flying. Use `/fly-stop` first.');
    if (db.listActiveFly().length >= MAX_ACTIVE) throw new UserError(`At most ${MAX_ACTIVE} members can fly at the same time.`);

    const channels = await liveChannels(guild);
    if (channels.length < 2) throw new UserError('Set at least 2 voice channels first with `/fly-channels set`.');
    const me = await guild.members.fetchMe();
    for (const ch of channels) await checkChannel(guild, me, ch.id);

    const now = Date.now();
    let id;
    try {
      id = db.insertFly({ userId: targetUserId, moderatorId, channels: channels.map((c) => c.id), intervalMs: intervalSec * 1000, startedAt: now, expiresAt: now + durationMs });
    } catch (e) {
      if (String(e.code).startsWith('SQLITE_CONSTRAINT')) throw new UserError('That member is already flying.');
      throw e;
    }
    db.audit(targetUserId, 'fly_started', { flyId: id, moderatorId, intervalSec, durationMs });
    const fly = db.getFly(id);
    await log(flyEmbed('FLY STARTED', fly));
    return fly;
  }

  async function stopFly({ guild, moderatorId, userId }) {
    await assertAuthorized(guild, moderatorId, db);
    const fly = db.getActiveFly(userId);
    if (!fly) throw new UserError('That member is not flying.');
    db.endFly(fly.id, 'stopped', `Stopped by ${moderatorId}`);
    db.audit(userId, 'fly_stopped', { flyId: fly.id, moderatorId });
    const done = db.getFly(fly.id);
    await log(flyEmbed('FLY STOPPED', done, `Stopped by <@${moderatorId}>`));
    return done;
  }

  async function stopAll({ guild, moderatorId }) {
    await assertAuthorized(guild, moderatorId, db);
    const all = db.listActiveFly();
    if (!all.length) throw new UserError('Nobody is flying right now.');
    for (const f of all) { db.endFly(f.id, 'stopped', `Stopped by ${moderatorId}`); db.audit(f.user_id, 'fly_stopped', { flyId: f.id, moderatorId }); }
    await log(brandEmbed('ALL FLIES STOPPED').addFields(
      { name: 'Stopped', value: String(all.length), inline: true }, { name: 'By', value: `<@${moderatorId}>`, inline: true }));
    return all.length;
  }


  async function processDue() {
    if (sweeping) return;
    sweeping = true;
    try {
      const now = Date.now();
      const due = db.dueFly(now);
      if (!due.length) return;
      const s = db.getSettings();
      const guild = s.guild_id ? await client.guilds.fetch(s.guild_id).catch(() => null) : null;
      if (!guild) return;

      for (const f of due) {
        if (f.expires_at <= now) {
          db.endFly(f.id, 'finished', 'Time is up');
          await log(flyEmbed('FLY FINISHED', db.getFly(f.id)));
          continue;
        }
        const current = guild.voiceStates.cache.get(f.user_id)?.channelId ?? null;
        if (!current) { db.scheduleFly(f.id, now + f.interval_ms); continue; }  
        const target = nextTarget(JSON.parse(f.channels), f.next_idx, current);
        if (!target) { db.scheduleFly(f.id, now + f.interval_ms); continue; }
        try {
          await guild.members.edit(f.user_id, { channel: target.channelId, reason: `Fly started by ${f.moderator_id}` });
          db.recordFlyMove(f.id, target.idx, Date.now() + f.interval_ms);
        } catch (err) {
          if (err.code === 40032) { db.scheduleFly(f.id, Date.now() + f.interval_ms); continue; }  
          if (err.code === 10007) {                                                                 
            db.endFly(f.id, 'finished', 'The member left the server');
            await log(flyEmbed('FLY FINISHED', db.getFly(f.id), 'The member left the server.'));
            continue;
          }
          const failures = db.bumpFlyFailure(f.id, Date.now() + f.interval_ms);
          if (failures >= MAX_FAILURES) {
            db.endFly(f.id, 'failed', err.message);
            await log(flyEmbed('FLY STOPPED (FAILED)', db.getFly(f.id), `Could not move the member ${MAX_FAILURES} times in a row: ${err.message}`));
          }
        }
      }
    } finally { sweeping = false; }
  }

  return { startFly, stopFly, stopAll, processDue, flyEmbed, checkChannel, liveChannels };
}

module.exports = { createFlyService, nextTarget, MIN_INTERVAL, MAX_INTERVAL };
