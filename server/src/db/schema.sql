-- Continuum schema version 1, including the frozen future-phase tables.
CREATE TABLE schema_version (version INTEGER NOT NULL);
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL CHECK (workspace IN ('live','lab')),
  title TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'real' CHECK (origin IN ('real','fake','sample')),
  created_logical_at TEXT NOT NULL, updated_logical_at TEXT NOT NULL,
  UNIQUE (id, workspace));                                   -- target of composite FKs

CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL, workspace TEXT NOT NULL,
  client_turn_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL, assistant_message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','done')),
  terminal_code TEXT,              -- COMPLETED | CANCELLED | DEADLINE | PROVIDER_UNAVAILABLE | ... | INTERRUPTED
  lab_epoch INTEGER,               -- NULL in live
  pinned_episode_id TEXT,          -- set when continuing a clarification (§10.4)
  started_real TEXT NOT NULL, ended_real TEXT,
  FOREIGN KEY (conversation_id, workspace) REFERENCES conversations(id, workspace) ON DELETE CASCADE,
  UNIQUE (conversation_id, client_turn_id));                 -- idempotency (F14)
CREATE UNIQUE INDEX ux_one_active_turn ON turns(conversation_id) WHERE status = 'active';  -- durable lock

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL, workspace TEXT NOT NULL,
  turn_id TEXT REFERENCES turns(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,                       -- immutable once status is terminal
  status TEXT NOT NULL CHECK (status IN ('streaming','complete','partial','cancelled','error')),
  terminal_code TEXT,
  origin TEXT NOT NULL DEFAULT 'real' CHECK (origin IN ('real','fake','sample')),
  logical_at TEXT NOT NULL,                    -- authoritative for all date logic (UTC ISO)
  recorded_at TEXT NOT NULL,
  tz TEXT NOT NULL,                            -- IANA tz of the request that created it
  local_date TEXT NOT NULL,                    -- display only: YYYY-MM-DD of logical_at in tz (F02)
  route TEXT, reply_to TEXT REFERENCES messages(id) ON DELETE CASCADE,
  stats_json TEXT,
  FOREIGN KEY (conversation_id, workspace) REFERENCES conversations(id, workspace) ON DELETE CASCADE);
CREATE INDEX ix_msg_ws_logical ON messages(workspace, logical_at);    -- F02
CREATE INDEX ix_msg_conv ON messages(conversation_id, logical_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid',
  tokenize='porter unicode61');
-- AFTER INSERT / AFTER DELETE / AFTER UPDATE OF content triggers keep messages_fts in sync.
-- FK cascades fire these triggers (verified on Node 24.11 / SQLite 3.50.4, 2026-11-18).

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,                    -- shown as E<ordinal>
  entity TEXT,                                 -- requested entity this source was gathered for (F10)
  query TEXT NOT NULL, url TEXT NOT NULL, title TEXT, domain TEXT NOT NULL,
  domain_match TEXT NOT NULL CHECK (domain_match IN ('exact','none')),   -- F09; never "first party"
  sentences_json TEXT NOT NULL, published_at TEXT, retrieved_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'real' CHECK (origin IN ('real','fake','sample')),
  UNIQUE (message_id, ordinal));
CREATE TABLE citations (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  ref TEXT NOT NULL, PRIMARY KEY (message_id, ref));     -- E3.2 | H<msgShort>.4
CREATE TABLE comparisons (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  baseline_message_ids TEXT NOT NULL, items_json TEXT NOT NULL,
  coverage_json TEXT NOT NULL, headline_json TEXT NOT NULL);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('generation','search')),
  provider TEXT, model TEXT, outcome TEXT, http_status INTEGER,
  latency_ms INTEGER, started_real TEXT NOT NULL);
CREATE TABLE clarifications (
  id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL, workspace TEXT NOT NULL,
  original_text TEXT NOT NULL, options_json TEXT NOT NULL,   -- [{label, episodeMessageId}]
  consumed INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (conversation_id, workspace) REFERENCES conversations(id, workspace) ON DELETE CASCADE);
CREATE TABLE lab_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  logical_anchor TEXT, real_anchor TEXT, epoch INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
INSERT INTO schema_version VALUES (1);
INSERT INTO lab_state (id) VALUES (1);
