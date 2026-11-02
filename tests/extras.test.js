// Tests for the typing effect and the clear-log feature (pretend Discord objects, no real connection).
const test = require('node:test');
const assert = require('node:assert');
const { Collection, PermissionFlagsBits } = require('discord.js');
const { createDb } = require('../src/db');
const { createTypingService } = require('../src/services/typing');
const { createLogAdmin } = require('../src/services/logAdmin');
const { UserError, AccessError } = require('../src/errors');

const DAY = 86400000;
function base() {
  const db = createDb(':memory:');
  db.setSettings({ setup_completed: true, guild_id: 'G', authorized_role_id: 'AUTH' });
  const members = { fetch: async ({ user }) => ({ roles: { cache: new Map(user === 'mod' ? [['AUTH', {}]] : []) } }), fetchMe: async () => ({ id: 'BOT' }) };
  return { db, members, logs: [], log(e) { this.logs.push(e.data.title); } };
}

test('typing: shows the indicator without sending any message, and can be switched off', async () => {
  const b = base(); let typed = 0; let sentMessages = 0;
  const channel = { id: 't1', isTextBased: () => true, isVoiceBased: () => false, permissionsFor: () => ({ has: () => true }), sendTyping: async () => { typed++; }, send: async () => { sentMessages++; } };
  const guild = { id: 'G', channels: { fetch: async () => channel }, members: b.members };
  const client = { channels: { fetch: async () => channel } };
  const svc = createTypingService({ db: b.db, client, log: async (e) => b.logs.push(e.data.title) });
  await svc.tick(); assert.strictEqual(typed, 0);                    // nothing set yet
  await svc.set({ guild, moderatorId: 'mod', channelId: 't1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(typed >= 1);
  await svc.tick(); assert.ok(typed >= 2);
  assert.strictEqual(sentMessages, 0, 'must never send a message');
  await svc.off({ guild, moderatorId: 'mod' });
  const before = typed; await svc.tick(); assert.strictEqual(typed, before);
});

test('typing: needs the authorized role, a text channel and the right permissions', async () => {
  const b = base();
  const ch = (perm) => ({ id: 't1', isTextBased: () => true, isVoiceBased: () => false, permissionsFor: () => ({ has: () => perm }), sendTyping: async () => {} });
  const mk = (c) => ({ svc: createTypingService({ db: b.db, client: { channels: { fetch: async () => c } }, log: async () => {} }), guild: { id: 'G', channels: { fetch: async () => c }, members: b.members } });
  let x = mk(ch(true));
  await assert.rejects(() => x.svc.set({ guild: x.guild, moderatorId: 'nobody', channelId: 't1' }), AccessError);
  x = mk(ch(false));
  await assert.rejects(() => x.svc.set({ guild: x.guild, moderatorId: 'mod', channelId: 't1' }), /Send Messages/);
  x = mk({ ...ch(true), isVoiceBased: () => true });
  await assert.rejects(() => x.svc.set({ guild: x.guild, moderatorId: 'mod', channelId: 't1' }), UserError);
  assert.strictEqual(b.db.getSettings().typing_channel_id, null);
});

// ---------- clear-log ----------
function logWorld({ manage = true } = {}) {
  const b = base();
  b.db.setSetting('log_channel_id', 'L');
  const now = Date.now();
  const deleted = [];
  const mk = (id, over = {}) => ({ id, author: { id: 'BOT' }, embeds: [{}], attachments: { size: 0 }, pinned: false, createdTimestamp: now - Number(id.slice(1)) * 1000,
    delete: async () => { deleted.push(id); }, ...over });
  // newest first
  const all = [mk('m1'), mk('m2'), mk('m3', { author: { id: 'HUMAN' } }), mk('m4', { embeds: [] }), mk('m5', { attachments: { size: 1 } }),
    mk('m6', { pinned: true }), mk('m7'), mk('m8', { createdTimestamp: now - 20 * DAY })];
  const channel = {
    isTextBased: () => true,
    permissionsFor: () => ({ has: (p) => (p === PermissionFlagsBits.ManageMessages ? manage : true) }),
    messages: { fetch: async ({ limit, before }) => { const s = before ? all.findIndex((m) => m.id === before) + 1 : 0; return new Collection(all.slice(s, s + limit).map((m) => [m.id, m])); } },
    bulkDelete: async (list) => { for (const m of list) deleted.push(m.id); return new Collection(list.map((m) => [m.id, m])); },
  };
  const guild = { id: 'G', channels: { fetch: async () => channel }, members: b.members };
  const svc = createLogAdmin({ db: b.db, client: { user: { id: 'BOT' } }, log: async (e) => b.logs.push(e.data.title) });
  return { ...b, svc, guild, deleted };
}

test('clear-log deletes ONLY my log embeds (not humans, announcements, pinned or text-only messages)', async () => {
  const w = logWorld();
  const r = await w.svc.clearLog({ guild: w.guild, moderatorId: 'mod', amount: 50 });
  assert.deepStrictEqual(w.deleted.sort(), ['m1', 'm2', 'm7', 'm8']);
  assert.strictEqual(r.deleted, 4);
  assert.ok(w.logs.includes('LOG CLEARED'));          // it says so in the log afterwards
});

test('clear-log respects the amount (newest first) and works without Manage Messages (one by one)', async () => {
  const w = logWorld({ manage: false });
  const r = await w.svc.clearLog({ guild: w.guild, moderatorId: 'mod', amount: 2 });
  assert.deepStrictEqual(w.deleted.sort(), ['m1', 'm2']);
  assert.strictEqual(r.deleted, 2);
});

test('clear-log needs the authorized role and a log channel', async () => {
  const w = logWorld();
  await assert.rejects(() => w.svc.clearLog({ guild: w.guild, moderatorId: 'nobody', amount: 5 }), AccessError);
  assert.strictEqual(w.deleted.length, 0);
  w.db.setSetting('log_channel_id', null);
  await assert.rejects(() => w.svc.clearLog({ guild: w.guild, moderatorId: 'mod', amount: 5 }), /No log channel/);
});

test('every command file loads and is valid for Discord (catches typos before you deploy)', () => {
  const { loadCommands } = require('../src/loader');
  const cmds = loadCommands();
  for (const [name, cmd] of cmds) {
    const json = cmd.data.toJSON();
    assert.strictEqual(json.name, name);
    assert.strictEqual(json.default_member_permissions, '0', `${name} must be hidden by default`);
    assert.strictEqual(typeof cmd.execute, 'function', name);
  }
  assert.deepStrictEqual([...cmds.keys()].sort(),
    ['247', 'clear-log', 'fly-announce', 'fly-channels', 'fly-config', 'fly-interval', 'fly-list', 'fly-member', 'fly-stop', 'typing']);
});
