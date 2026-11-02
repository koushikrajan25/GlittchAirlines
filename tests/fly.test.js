// Tests the fly engine against a pretend Discord server (no real connection needed).
const test = require('node:test');
const assert = require('node:assert');
const { ChannelType } = require('discord.js');
const { createDb } = require('../src/db');
const { createFlyService, createLimiter, nextTarget } = require('../src/services/fly');
const { UserError, AccessError } = require('../src/errors');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GOOD = { has: () => true };

function world({ inVoice = 'a', failWith = null, channels = ['a', 'b', 'c'], savedIds = ['a', 'b', 'c'], perms = GOOD } = {}) {
  const db = createDb(':memory:');
  db.setSettings({ setup_completed: true, guild_id: 'G', authorized_role_id: 'AUTH', fly_channel_ids: savedIds });
  const moves = [];
  const voiceStates = new Map(inVoice ? [['u1', { channelId: inVoice }]] : []);
  const chans = Object.fromEntries(channels.map((id) => [id, { id, type: ChannelType.GuildVoice, permissionsFor: () => perms }]));
  const guild = {
    id: 'G', ownerId: 'OWNER', voiceStates: { cache: voiceStates },
    channels: { fetch: async (id) => { if (!chans[id]) throw new Error('Unknown Channel'); return chans[id]; } },
    members: {
      edit: async (id, { channel }) => { if (failWith) throw failWith; moves.push(channel); voiceStates.set(id, { channelId: channel }); },
      fetch: async ({ user }) => ({ roles: { cache: new Map(user === 'mod' ? [['AUTH', {}]] : []) } }),
      fetchMe: async () => ({ id: 'BOT' }),
    },
  };
  const client = { user: { id: 'BOT' }, guilds: { fetch: async () => guild } };
  const logs = [];
  const fly = createFlyService({ db, client, log: async (e) => logs.push(e.data.title) });
  const add = (over = {}) => db.insertFly({ userId: 'u1', moderatorId: 'mod', channels: ['a', 'b', 'c'], intervalMs: 10, startedAt: Date.now() - 1, expiresAt: Date.now() + 60000, ...over });
  const start = (over = {}) => fly.startFly({ guild, moderatorId: 'mod', targetUserId: 'u1', ...over });
  return { db, fly, guild, moves, logs, add, start };
}

test('nextTarget rotates and never picks the channel the member is already in', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepStrictEqual(nextTarget(ids, 0, 'x'), { channelId: 'a', idx: 1 });
  assert.deepStrictEqual(nextTarget(ids, 1, 'b'), { channelId: 'c', idx: 0 });
  assert.strictEqual(nextTarget(['a'], 0, 'a'), null);
});

test('/fly-member uses the saved default channels, interval and duration', async () => {
  const w = world();
  w.db.setSettings({ default_interval_seconds: 20, default_duration_ms: 5 * 60000 });
  const f = await w.start();
  assert.deepStrictEqual(JSON.parse(f.channels), ['a', 'b', 'c']);
  assert.strictEqual(f.interval_ms, 20000);
  assert.ok(Math.abs((f.expires_at - f.started_at) - 5 * 60000) < 50);
  assert.ok(w.logs.includes('FLY STARTED'));
});

test('overrides for interval and duration work, and bad values are refused', async () => {
  const w = world();
  const f = await w.start({ intervalSec: 7, durationMs: 120000 });
  assert.strictEqual(f.interval_ms, 7000);
  const w2 = world();
  await assert.rejects(() => w2.start({ intervalSec: 0.5 }), UserError);
  await assert.rejects(() => w2.start({ durationMs: 30 * 24 * 3600 * 1000 }), UserError);
});

test('refuses to start without at least 2 default channels', async () => {
  await assert.rejects(() => world({ savedIds: [] }).start(), /at least 2/);
  await assert.rejects(() => world({ savedIds: ['a'] }).start(), /at least 2/);
});

test('deleted channels are forgotten automatically', async () => {
  const w = world({ channels: ['a', 'b'], savedIds: ['a', 'b', 'gone'] });
  const f = await w.start();
  assert.deepStrictEqual(JSON.parse(f.channels), ['a', 'b']);
  assert.deepStrictEqual(w.db.getSettings().fly_channel_ids, ['a', 'b']);
  await assert.rejects(() => world({ channels: ['a'], savedIds: ['a', 'gone'] }).start(), /at least 2/);
});

test('refuses when the bot lacks permissions in a fly channel', async () => {
  await assert.rejects(() => world({ perms: { has: () => false } }).start(), /Move Members/);
});

test('only the authorized role can start or stop a fly', async () => {
  const w = world();
  await assert.rejects(() => w.fly.startFly({ guild: w.guild, moderatorId: 'nobody', targetUserId: 'u1' }), AccessError);
  assert.strictEqual(w.db.listActiveFly().length, 0);
  w.add();
  await assert.rejects(() => w.fly.stopFly({ guild: w.guild, moderatorId: 'nobody', userId: 'u1' }), AccessError);
  assert.strictEqual(w.db.listActiveFly().length, 1);
});

test('cannot fly the owner or the bot, or the same member twice', async () => {
  const w = world();
  await assert.rejects(() => w.start({ targetUserId: 'OWNER' }), /owner/);
  await assert.rejects(() => w.start({ targetUserId: 'BOT' }), /myself/);
  await w.start();
  await assert.rejects(() => w.start(), /already flying/);
});

test('stop one member, and stop everyone', async () => {
  const w = world();
  await w.start();
  await w.fly.stopFly({ guild: w.guild, moderatorId: 'mod', userId: 'u1' });
  assert.strictEqual(w.db.listActiveFly().length, 0);
  w.add(); w.add({ userId: 'u2' });
  assert.strictEqual(await w.fly.stopAll({ guild: w.guild, moderatorId: 'mod' }), 2);
  assert.strictEqual(w.db.listActiveFly().length, 0);
});

test('the engine moves the member around the channels in order', async () => {
  const w = world(); w.add();
  for (let i = 0; i < 4; i++) { await w.fly.processDue(); await wait(15); }
  assert.deepStrictEqual(w.moves, ['b', 'c', 'a', 'b']);
});

test('the engine waits while the member is not in voice', async () => {
  const w = world({ inVoice: null }); w.add();
  await w.fly.processDue();
  assert.strictEqual(w.moves.length, 0);
  assert.strictEqual(w.db.getActiveFly('u1').status, 'active');
});

test('3 failed moves in a row stop the fly; "not in voice" errors do not count', async () => {
  const w = world({ failWith: new Error('Missing Permissions') }); const id = w.add();
  for (let i = 0; i < 3; i++) { await w.fly.processDue(); await wait(15); }
  assert.strictEqual(w.db.getFly(id).status, 'failed');
  assert.ok(w.logs.includes('FLY STOPPED (FAILED)'));

  const e = Object.assign(new Error('Target user is not connected to voice'), { code: 40032 });
  const w2 = world({ failWith: e }); const id2 = w2.add();
  for (let i = 0; i < 5; i++) { await w2.fly.processDue(); await wait(15); }
  assert.strictEqual(w2.db.getFly(id2).status, 'active');
});

test('a fly finishes when its time is up, and survives a restart (saved in the database)', async () => {
  const w = world(); const id = w.add({ expiresAt: Date.now() - 1 });
  await w.fly.processDue();
  assert.strictEqual(w.db.getFly(id).status, 'finished');
  const w2 = world(); w2.add();
  assert.strictEqual(w2.db.dueFly(Date.now() + 1000).length, 1); // a restarted bot finds it again
});

test('the default pace comes from the saved default, and 0.7 is the shortest allowed', async () => {
  const w = world();
  const def = w.db.getSettings().default_interval_seconds;
  const f = await w.start();
  assert.strictEqual(f.interval_ms, def * 1000);
  const w2 = world();
  assert.strictEqual((await w2.start({ intervalSec: 0.7 })).interval_ms, 700);
  await assert.rejects(() => world().start({ intervalSec: 0.5 }), /0\.7-300/);
});

test('the rate limiter allows the capacity, blocks the rest, then recovers', () => {
  const l = createLimiter(3, 1000);
  assert.ok(l.tryTake(0) && l.tryTake(10) && l.tryTake(20));
  assert.strictEqual(l.tryTake(30), false);
  assert.strictEqual(l.tryTake(1000), true);   // the first stamp (t=0) has expired
  assert.strictEqual(l.tryTake(1001), false);
});

test('the engine stops moving once the rate budget is used up', async () => {
  const w = world(); w.add({ intervalMs: 1 });
  for (let i = 0; i < 20; i++) { await w.fly.processDue(); await wait(5); }
  assert.ok(w.moves.length <= 9, `moves: ${w.moves.length}`);
});

test('a 200ms fly really moves about every 200ms (timing check)', async () => {
  const w = world(); w.add({ intervalMs: 200 });
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) { await w.fly.processDue(); await wait(50); }
  const elapsed = Date.now() - t0;
  assert.ok(w.moves.length >= 2 && w.moves.length <= 4, `moves: ${w.moves.length} in ${elapsed}ms`);
});