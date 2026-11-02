const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../errors');
const { assertAuthorized } = require('../access');
const { brandEmbed, EMBED_COLOR } = require('../embeds');
const { BOT_NAME } = require('../brand');
const { formatDuration } = require('../utils');

const MAX_BYTES = 8 * 1024 * 1024;   // 8 MB
const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

function sniffImage(buf) {
  if (buf.length > 12 && buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'png';
  if (buf.length > 3 && buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
  if (buf.length > 6 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function renderText(template, { userId, durationMs, intervalMs }) {
  let text = String(template)
    .replaceAll('{member}', `<@${userId}>`)
    .replaceAll('{duration}', formatDuration(durationMs))
    .replaceAll('{interval}', `${Math.round(intervalMs / 1000)}s`);
  if (!text.includes(`<@${userId}>`)) text = `<@${userId}> ${text}`;
  return text.slice(0, 1900);
}

function createAnnounceService({ db, client, log, dataDir, fetchFn = globalThis.fetch }) {
  const imageFile = () => {
    const name = db.getSettings().announce_image_file;
    const p = name ? path.join(dataDir, name) : null;
    return p && fs.existsSync(p) ? { path: p, name } : null;
  };

  async function checkChannel(guild, channelId) {
    const ch = await guild.channels.fetch(channelId).catch(() => null);
    if (!ch || !ch.isTextBased() || ch.isVoiceBased()) throw new UserError('Please pick a normal text channel.');
    const me = await guild.members.fetchMe();
    const p = ch.permissionsFor(me);
    const need = [['ViewChannel', 'View Channel'], ['SendMessages', 'Send Messages'], ['AttachFiles', 'Attach Files'], ['EmbedLinks', 'Embed Links']];
    const missing = need.filter(([k]) => !p?.has(PermissionFlagsBits[k])).map(([, label]) => label);
    if (missing.length) throw new UserError(`I need these permissions in <#${channelId}>: **${missing.join(', ')}**.`);
    return ch;
  }

  async function setImage({ guild, moderatorId, attachment }) {
    await assertAuthorized(guild, moderatorId, db);
    const type = String(attachment.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!TYPES[type]) throw new UserError('Please upload a PNG, JPG, GIF or WEBP picture.');
    if (attachment.size > MAX_BYTES) throw new UserError('That picture is too big. The limit is 8 MB.');
    let host = '';
    try { host = new URL(attachment.url).hostname; } catch { /* handled below */ }
    if (!/(^|\.)(discordapp\.com|discordapp\.net|discord\.com)$/.test(host)) throw new UserError('That picture does not come from Discord.');

    const res = await fetchFn(attachment.url);
    if (!res.ok) throw new UserError('I could not download that picture. Please try again.');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new UserError('That picture is too big. The limit is 8 MB.');
    const ext = sniffImage(buf);
    if (!ext) throw new UserError('That file is not a valid picture.');

    fs.mkdirSync(dataDir, { recursive: true });
    const name = `announce-image.${ext}`;
    const old = db.getSettings().announce_image_file;
    fs.writeFileSync(path.join(dataDir, name), buf);
    if (old && old !== name) fs.rmSync(path.join(dataDir, old), { force: true });
    db.setSetting('announce_image_file', name);
    db.audit(moderatorId, 'announce_image_set', { name, bytes: buf.length });
    await log(brandEmbed('ANNOUNCEMENT IMAGE CHANGED').addFields({ name: 'By', value: `<@${moderatorId}>`, inline: true }));
    return { name, path: path.join(dataDir, name) };
  }

  async function removeImage({ guild, moderatorId }) {
    await assertAuthorized(guild, moderatorId, db);
    const old = db.getSettings().announce_image_file;
    if (!old) throw new UserError('There is no announcement image set.');
    fs.rmSync(path.join(dataDir, old), { force: true });
    db.setSetting('announce_image_file', null);
    db.audit(moderatorId, 'announce_image_removed', { old });
    await log(brandEmbed('ANNOUNCEMENT IMAGE REMOVED').addFields({ name: 'By', value: `<@${moderatorId}>`, inline: true }));
  }

  function build(fly) {
    const s = db.getSettings();
    const img = imageFile();
    const payload = {
      content: renderText(s.announce_text, { userId: fly.user_id, durationMs: fly.expires_at - fly.started_at, intervalMs: fly.interval_ms }),
      allowedMentions: { parse: [], users: [fly.user_id] },   // ONLY this one member can be pinged
      embeds: [], files: [],
    };
    if (img) {
      payload.files = [new AttachmentBuilder(img.path, { name: img.name })];
      payload.embeds = [new EmbedBuilder().setColor(EMBED_COLOR).setImage(`attachment://${img.name}`).setFooter({ text: BOT_NAME })];
    }
    return payload;
  }

  async function announceFlight({ guild, fly, fallbackChannelId }) {
    const s = db.getSettings();
    if (!s.announce_enabled) return { sent: false };
    const channel = await checkChannel(guild, s.announce_channel_id ?? fallbackChannelId);
    await channel.send(build(fly));
    return { sent: true, channelId: channel.id };
  }

  return { setImage, removeImage, announceFlight, build, checkChannel, imageFile };
}

module.exports = { createAnnounceService, renderText, sniffImage };
