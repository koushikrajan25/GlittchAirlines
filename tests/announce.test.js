// Tests for the flight announcement (custom image + ping) using pretend Discord objects.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('../src/db');
const { createAnnounceService, renderText, sniffImage } = require('../src/services/announce');
const { UserError, AccessError } = require('../src/errors');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);

function world({ canSend = true } = {}) {
  const db = createDb(':memory:');
  db.setSettings({ setup_completed: true, guild_id: 'G', authorized_role_id: 'AUTH' });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'announce-'));
  const sent = [];
  const channel = (id) => ({ id, isTextBased: () => true, isVoiceBased: () => false, permissionsFor: () => ({ has: () => canSend }), send: async (p) => sent.push({ id, ...p }) });
  const guild = {
    id: 'G',
    channels: { fetch: async (id) => channel(id) },
    members: { fetch: async ({ user }) => ({ roles: { cache: new Map(user === 'mod' ? [['AUTH', {}]] : []) } }), fetchMe: async () => ({ id: 'BOT' }) },
  };
  let body = PNG;
  const fetchFn = async () => ({ ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
  const logs = [];
  const svc = createAnnounceService({ db, client: {}, log: async (e) => logs.push(e.data.title), dataDir, fetchFn });
  const setBody = (b) => { body = b; };
  const fly = { user_id: 'u1', started_at: 0, expires_at: 10 * 60000, interval_ms: 10000 };
  const att = (over = {}) => ({ contentType: 'image/png', size: 100, url: 'https://cdn.discordapp.com/attachments/1/2/pic.png', ...over });
  return { db, svc, guild, sent, dataDir, setBody, fly, att, logs };
}

test('the message template fills in the ping, duration and interval, and always pings', () => {
  const o = { userId: 'u1', durationMs: 10 * 60000, intervalMs: 10000 };
  assert.strictEqual(renderText('{member} flies for {duration} every {interval}', o), '<@u1> flies for 10m every 10s');
  assert.strictEqual(renderText('Bon voyage!', o), '<@u1> Bon voyage!');   // forgot {member}: ping added anyway
});

test('pictures are recognised by their real content', () => {
  assert.strictEqual(sniffImage(PNG), 'png');
  assert.strictEqual(sniffImage(JPG), 'jpg');
  assert.strictEqual(sniffImage(Buffer.from('hello world, I am not a picture')), null);
});

test('announcement: pings ONLY the flying member and attaches the saved image in an embed', async () => {
  const w = world();
  await w.svc.setImage({ guild: w.guild, moderatorId: 'mod', attachment: w.att() });
  const r = await w.svc.announceFlight({ guild: w.guild, fly: w.fly, fallbackChannelId: 'here' });
  assert.strictEqual(r.sent, true);
  const m = w.sent[0];
  assert.strictEqual(m.id, 'here');
  assert.ok(m.content.includes('<@u1>'));
  assert.deepStrictEqual(m.allowedMentions, { parse: [], users: ['u1'] });
  assert.strictEqual(m.files.length, 1);
  assert.strictEqual(m.embeds[0].data.color, 0x000001);
});

test('announcement without an image still pings; a chosen channel beats the fallback; off means silent', async () => {
  const w = world();
  w.db.setSetting('announce_channel_id', 'announce-ch');
  await w.svc.announceFlight({ guild: w.guild, fly: w.fly, fallbackChannelId: 'here' });
  assert.strictEqual(w.sent[0].id, 'announce-ch');
  assert.ok(w.sent[0].content.includes('<@u1>'));
  assert.strictEqual(w.sent[0].files.length, 0);
  w.db.setSetting('announce_enabled', false);
  assert.strictEqual((await w.svc.announceFlight({ guild: w.guild, fly: w.fly, fallbackChannelId: 'here' })).sent, false);
  assert.strictEqual(w.sent.length, 1);
});

test('missing permissions in the channel give a clear error', async () => {
  const w = world({ canSend: false });
  await assert.rejects(() => w.svc.announceFlight({ guild: w.guild, fly: w.fly, fallbackChannelId: 'here' }), /Attach Files/);
});

test('uploads are validated: type, size, source, real picture, and only the authorized role', async () => {
  const w = world();
  const set = (att, who = 'mod') => w.svc.setImage({ guild: w.guild, moderatorId: who, attachment: att });
  await assert.rejects(() => set(w.att({ contentType: 'application/pdf' })), UserError);
  await assert.rejects(() => set(w.att({ size: 9 * 1024 * 1024 })), /too big/);
  await assert.rejects(() => set(w.att({ url: 'https://evil.example.com/x.png' })), /does not come from Discord/);
  w.setBody(Buffer.from('this is not a picture at all, sorry'));
  await assert.rejects(() => set(w.att()), /not a valid picture/);
  w.setBody(PNG);
  await assert.rejects(() => set(w.att(), 'nobody'), AccessError);
  assert.strictEqual(w.db.getSettings().announce_image_file, null);
});

test('replacing the picture deletes the old file; removing it clears the setting', async () => {
  const w = world();
  await w.svc.setImage({ guild: w.guild, moderatorId: 'mod', attachment: w.att() });
  assert.ok(fs.existsSync(path.join(w.dataDir, 'announce-image.png')));
  w.setBody(JPG);
  await w.svc.setImage({ guild: w.guild, moderatorId: 'mod', attachment: w.att({ contentType: 'image/jpeg' }) });
  assert.ok(!fs.existsSync(path.join(w.dataDir, 'announce-image.png')));
  assert.ok(fs.existsSync(path.join(w.dataDir, 'announce-image.jpg')));
  await w.svc.removeImage({ guild: w.guild, moderatorId: 'mod' });
  assert.strictEqual(w.db.getSettings().announce_image_file, null);
  assert.ok(!fs.existsSync(path.join(w.dataDir, 'announce-image.jpg')));
});
