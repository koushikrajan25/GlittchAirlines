const test = require('node:test');
const assert = require('node:assert');
const { createDb } = require('../src/db');
const { handleInteraction } = require('../src/router');
const { decideAccess } = require('../src/access');

const GUILD = 'G1', AUTH = 'AUTH';
const COMMANDS = ['fly-member', 'fly-stop', 'fly-list', 'fly-channels', 'fly-interval', 'fly-config', 'fly-announce', '247', 'typing', 'clear-log'];
let uid = 0; 

function fake({ roles = [], admin = false, owner = false, cmd = 'fly-member', guildId = GUILD, roleExists = true, button = false } = {}) {
  const replies = [];
  return {
    replies, guildId, commandName: button ? undefined : cmd, customId: button ? `${cmd}:x` : undefined,
    user: { id: `U${++uid}` }, deferred: false, replied: false,
    memberPermissions: { has: () => admin || owner },
    guild: {
      id: guildId, ownerId: 'OWNER',
      roles: { fetch: async () => (roleExists ? { id: AUTH } : null) },
      members: { fetch: async () => ({ roles: { cache: new Map(roles.map((r) => [r, { id: r }])) } }) },
    },
    isChatInputCommand: () => !button, isContextMenuCommand: () => false, isAutocomplete: () => false,
    isButton: () => button, isAnySelectMenu: () => false, isModalSubmit: () => false,
    reply: async function (p) { this.replied = true; replies.push(p); },
    deferReply: async function () { this.deferred = true; },
    editReply: async function (p) { replies.push(p); },
  };
}
function setup({ done = true } = {}) {
  const db = createDb(':memory:');
  if (done) db.setSettings({ setup_completed: true, guild_id: GUILD, authorized_role_id: AUTH });
  const ran = [];
  const mk = (name) => ({ data: { name }, execute: async () => { ran.push(name); }, handleComponent: async () => { ran.push(name); } });
  return { ctx: { db, commands: new Map(COMMANDS.map((n) => [n, mk(n)])) }, ran, db };
}
const isDenied = (i) => i.replies.some((r) => r.embeds?.[0]?.data?.title === 'ACCESS DENIED');

test('member WITH the authorized role can use every command', async () => {
  const { ctx, ran } = setup();
  for (const cmd of COMMANDS) { const i = fake({ roles: [AUTH], cmd }); await handleInteraction(i, ctx); assert.ok(!isDenied(i), cmd); }
  assert.strictEqual(ran.length, COMMANDS.length);
});

test('member WITHOUT the role is denied on every command (even read-only ones)', async () => {
  const { ctx, ran } = setup();
  for (const cmd of COMMANDS) { const i = fake({ roles: ['OTHER'], cmd }); await handleInteraction(i, ctx); assert.ok(isDenied(i), cmd); }
  assert.strictEqual(ran.length, 0, 'no command logic may run');
});

test('server ADMINISTRATOR without the role is denied', async () => {
  const { ctx, ran } = setup();
  const i = fake({ admin: true, roles: ['ADMINROLE'] });
  await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('server OWNER without the role is denied', async () => {
  const { ctx, ran } = setup();
  const i = fake({ owner: true, roles: [] });
  await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('losing the role removes access immediately; gaining it grants access (no restart)', async () => {
  const { ctx, ran } = setup();
  let i = fake({ roles: [AUTH] }); await handleInteraction(i, ctx); assert.ok(!isDenied(i));
  i = fake({ roles: [] });         await handleInteraction(i, ctx); assert.ok(isDenied(i));
  i = fake({ roles: [AUTH] });     await handleInteraction(i, ctx); assert.ok(!isDenied(i));
  assert.strictEqual(ran.length, 2);
});

test('buttons / menus from unauthorized users are denied too', async () => {
  const { ctx, ran } = setup();
  const i = fake({ roles: [], cmd: 'fly-list', button: true });
  await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('wrong server is denied', async () => {
  const { ctx, ran } = setup();
  const i = fake({ roles: [AUTH], guildId: 'OTHER_GUILD' });
  await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('not configured: EVERYONE is denied, even an administrator', async () => {
  const { ctx, ran } = setup({ done: false });
  const i = fake({ admin: true }); await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('authorized role deleted from the server: fail closed for everyone, admins included', async () => {
  const { ctx, ran } = setup();
  for (const opts of [{ roles: [AUTH] }, { admin: true }, { owner: true }]) {
    const i = fake({ ...opts, roleExists: false }); await handleInteraction(i, ctx); assert.ok(isDenied(i));
  }
  assert.strictEqual(ran.length, 0);
});

test('fail closed when the configuration cannot be loaded', async () => {
  const { ctx, ran } = setup();
  ctx.db = { getSettings() { throw new Error('database broken'); } };
  const i = fake({ roles: [AUTH] });
  await handleInteraction(i, ctx);
  assert.ok(isDenied(i)); assert.strictEqual(ran.length, 0);
});

test('an unauthorized interaction does not change the database', async () => {
  const { ctx, db } = setup();
  const before = JSON.stringify(db.getSettings());
  await handleInteraction(fake({ roles: [], cmd: 'fly-config' }), ctx);
  assert.strictEqual(JSON.stringify(db.getSettings()), before);
  assert.strictEqual(db.listActiveFly().length, 0);
});

test('decideAccess: only the exact role ID counts', () => {
  const settings = { setup_completed: true, guild_id: GUILD, authorized_role_id: AUTH };
  const base = { settings, guildId: GUILD, roleExists: true };
  assert.strictEqual(decideAccess({ ...base, memberRoleIds: ['AUTH2'] }).allowed, false);
  assert.strictEqual(decideAccess({ ...base, memberRoleIds: [AUTH] }).allowed, true);
});
