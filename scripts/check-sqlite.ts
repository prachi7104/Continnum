// Proves the SQLite features the frozen schema relies on.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiagnosticDatabase } from '../server/src/db/repo.ts';
import { migrate } from '../server/src/db/migrate.ts';

const dir = mkdtempSync(join(tmpdir(), 'continuum-sqlite-'));
const db = new DiagnosticDatabase(join(dir, 'probe.db'));
try {
  assert.equal(db.prepare('PRAGMA journal_mode=WAL').get()?.journal_mode, 'wal');
  console.log('PASS WAL');
  db.exec('PRAGMA foreign_keys=ON');
  assert.equal(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys, 1);
  migrate(db);
  db.exec("INSERT INTO conversations VALUES ('c', 'live', 'Check', 'real', 'a', 'a')");
  const message = db.prepare(`INSERT INTO messages (id,conversation_id,workspace,role,content,status,logical_at,recorded_at,tz,local_date)
    VALUES (?, ?, ?, 'user', ?, 'complete', 'a', 'a', 'UTC', 'a')`);
  assert.throws(() => message.run('bad1', 'missing', 'live', 'hello'), /FOREIGN KEY/);
  console.log('PASS foreign-key enforcement');
  assert.throws(() => message.run('bad2', 'c', 'lab', 'hello'), /FOREIGN KEY/);
  console.log('PASS composite workspace foreign key');
  message.run('one', 'c', 'live', 'The runner is running');
  message.run('two', 'c', 'live', 'This runner starts running while other athletes train during long sessions');
  const match = db.prepare("SELECT bm25(messages_fts) AS rank FROM messages_fts WHERE messages_fts MATCH 'runs' ORDER BY rank");
  const scores = match.all().map(row => Number(row.rank));
  assert.equal(scores.length, 2);
  console.log('PASS FTS5 porter stemming');
  assert.ok(scores[0] < scores[1] && scores[1] < 0);
  console.log('PASS bm25 negative, lower is better');
  db.exec("DELETE FROM conversations WHERE id='c'; INSERT INTO messages_fts(messages_fts, rank) VALUES('integrity-check', 1);");
  assert.equal(match.all().length, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get()?.n, 0);
  console.log('PASS cascade fires FTS delete trigger and integrity-check');
  console.log('SQLite ' + db.prepare('SELECT sqlite_version() AS version').get()?.version);
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
