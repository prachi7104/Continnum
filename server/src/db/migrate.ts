// Installs the versioned schema inside the caller's write transaction.
import { readFileSync } from 'node:fs';

export function migrate(db: { exec(sql: string): void, prepare(sql: string): { get(): unknown } }) {
  const versionTable = db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_version'").get();
  if (!versionTable) {
    db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    return;
  }
  const version = db.prepare('SELECT version FROM schema_version').get() as {version: number} | undefined;
  if (version?.version !== 1) throw new Error('Unsupported database schema version');
}
