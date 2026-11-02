
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { HOUR, MIN } = require('./utils');

const DEFAULTS = {
  guild_id: null,                  
  authorized_role_id: null,       
  setup_completed: false,
  log_channel_id: null,
  fly_channel_ids: [],           
  default_interval_seconds: 2,   
  default_duration_ms: 10 * MIN,   
  max_duration_ms: 24 * HOUR,     
  timezone: 'UTC',
  
  stay_vc_id: null,              
  typing_channel_id: null,        
  announce_enabled: true,
  announce_channel_id: null,   
  announce_text: '{member} is going on a flight! ✈️',
  announce_image_file: null,     
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS fly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, moderator_id TEXT NOT NULL,
  channels TEXT NOT NULL,                        -- JSON list of voice channel IDs (a copy taken when it started)
  interval_ms INTEGER NOT NULL,
  started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,   -- UTC milliseconds
  next_idx INTEGER NOT NULL DEFAULT 0,
  next_move_at INTEGER NOT NULL,
  moves INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',         -- active | stopped | finished | failed
  end_note TEXT
);
-- A person can only be flown by ONE job at a time. The database itself enforces this.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_fly_per_user ON fly(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, old_role_id TEXT, new_role_id TEXT, at INTEGER NOT NULL
);
`;

function createDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.exec(SCHEMA);

  const db = {
    raw,

    getSettings() {
      const out = { ...DEFAULTS };
      for (const row of raw.prepare('SELECT key, value FROM settings').all()) {
        if (row.key in DEFAULTS) { try { out[row.key] = JSON.parse(row.value); } catch { } }
      }
      return out;
    },
    hasSetting(key) { return !!raw.prepare('SELECT 1 FROM settings WHERE key = ?').get(key); },
    setSetting(key, value) {
      if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
      raw.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(key, JSON.stringify(value));
    },
    setSettings(obj) { raw.transaction(() => { for (const [k, v] of Object.entries(obj)) db.setSetting(k, v); })(); },


    insertFly(f) {
      return Number(raw.prepare(`INSERT INTO fly(user_id, moderator_id, channels, interval_ms, started_at, expires_at, next_move_at)
        VALUES(?,?,?,?,?,?,?)`).run(f.userId, f.moderatorId, JSON.stringify(f.channels), f.intervalMs, f.startedAt, f.expiresAt, f.startedAt).lastInsertRowid);
    },
    getFly(id) { return raw.prepare('SELECT * FROM fly WHERE id = ?').get(id); },
    getActiveFly(userId) { return raw.prepare(`SELECT * FROM fly WHERE user_id = ? AND status = 'active'`).get(userId); },
    listActiveFly() { return raw.prepare(`SELECT * FROM fly WHERE status = 'active' ORDER BY expires_at`).all(); },
    dueFly(now) { return raw.prepare(`SELECT * FROM fly WHERE status = 'active' AND (next_move_at <= ? OR expires_at <= ?) ORDER BY next_move_at`).all(now, now); },
    scheduleFly(id, nextMoveAt) { raw.prepare('UPDATE fly SET next_move_at = ? WHERE id = ?').run(nextMoveAt, id); },
    recordFlyMove(id, nextIdx, nextMoveAt) {
      raw.prepare('UPDATE fly SET next_idx = ?, next_move_at = ?, moves = moves + 1, failures = 0 WHERE id = ?').run(nextIdx, nextMoveAt, id);
    },
    bumpFlyFailure(id, nextMoveAt) {
      raw.prepare('UPDATE fly SET failures = failures + 1, next_move_at = ? WHERE id = ?').run(nextMoveAt, id);
      return raw.prepare('SELECT failures FROM fly WHERE id = ?').get(id).failures;
    },
    endFly(id, status, note) { return raw.prepare(`UPDATE fly SET status = ?, end_note = ? WHERE id = ? AND status = 'active'`).run(status, note ?? null, id).changes === 1; },

    audit(userId, action, detail = {}) {
      raw.prepare('INSERT INTO audit(user_id, action, detail, at) VALUES(?,?,?,?)').run(userId ?? null, action, JSON.stringify(detail), Date.now());
    },
    logAccessChange(actorId, oldRoleId, newRoleId) {
      raw.prepare('INSERT INTO access_log(actor_id, old_role_id, new_role_id, at) VALUES(?,?,?,?)').run(actorId, oldRoleId ?? null, newRoleId, Date.now());
    },
  };
  return db;
}

module.exports = { createDb, DEFAULTS };
