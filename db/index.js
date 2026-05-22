const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.resolve(__dirname, '..', 'mantrail.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schemaPath = path.resolve(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

function columnExists(table, col) {
  return !!db.prepare(`PRAGMA table_info(${table})`).all().find(r => r.name === col);
}

const current = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM schema_version').get().v;

const MIGRATIONS = [
  {
    version: 1,
    desc: 'Add display_name to users',
    up: () => { if (!columnExists('users', 'display_name')) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT"); },
  },
  {
    version: 2,
    desc: 'Add is_master to session_members',
    up: () => { if (!columnExists('session_members', 'is_master')) db.exec("ALTER TABLE session_members ADD COLUMN is_master INTEGER DEFAULT 0"); },
  },
  {
    version: 3,
    desc: 'Add is_admin to users',
    up: () => { if (!columnExists('users', 'is_admin')) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"); },
  },
  {
    version: 4,
    desc: 'Add can_invite to allowed_emails',
    up: () => { if (!columnExists('allowed_emails', 'can_invite')) db.exec("ALTER TABLE allowed_emails ADD COLUMN can_invite INTEGER DEFAULT 0"); },
  },
  {
    version: 5,
    desc: 'Add can_invite to invite_tokens',
    up: () => { if (!columnExists('invite_tokens', 'can_invite')) db.exec("ALTER TABLE invite_tokens ADD COLUMN can_invite INTEGER DEFAULT 0"); },
  },
  {
    version: 6,
    desc: 'Bootstrap first user invite rights',
    up: () => {
      const any = db.prepare("SELECT COUNT(*) as c FROM allowed_emails WHERE can_invite = 1").get();
      if (any.c === 0 && columnExists('allowed_emails', 'can_invite')) {
        const first = db.prepare("SELECT id FROM allowed_emails ORDER BY created_at ASC LIMIT 1").get();
        if (first) db.prepare("UPDATE allowed_emails SET can_invite = 1 WHERE id = ?").run(first.id);
      }
    },
  },
];

for (const m of MIGRATIONS) {
  if (m.version <= current) continue;
  m.up();
  db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(m.version, m.desc);
  console.log(`Migration V${m.version}: ${m.desc}`);
}

module.exports = { db };
