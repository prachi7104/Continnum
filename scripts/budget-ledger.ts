// Serializes qualification reservations across processes and persists them before dispatch.
import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wallClock } from '../server/src/clock.ts';

const caps = { gemini: 24, tavily: 5, groq: 0 };
type Provider = keyof typeof caps;
type Entry = { id: string; at: string; kind: Provider; model: string | null; purpose: string; outcome: string };
type Ledger = Record<Provider, { cap: number; used: number }> & { entries: Entry[] };
const defaultPath = fileURLToPath(new URL('../docs/qualification-ledger.json', import.meta.url));

export function readLedger(path = defaultPath): Ledger {
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
  for (const [kind, cap] of Object.entries(caps) as [Provider, number][]) {
    const row = ledger[kind];
    if (row.cap !== cap || row.used > cap || row.used !== ledger.entries.filter((entry) => entry.kind === kind).length) {
      throw new Error('Qualification ledger is inconsistent');
    }
  }
  if (ledger.entries.some((entry) => !Object.hasOwn(caps, entry.kind)) ||
      new Set(ledger.entries.map(({ id }) => id)).size !== ledger.entries.length) {
    throw new Error('Qualification ledger contains invalid entries');
  }
  return ledger;
}

function update<T>(path: string, modify: (ledger: Ledger) => T): T {
  const lock = path + '.lock';
  try {
    mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Qualification ledger is locked. Confirm the other process has exited before removing a stale lock.');
    }
    throw error;
  }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const ledger = readLedger(path);
    const result = modify(ledger);
    const fd = openSync(temporary, 'wx');
    try {
      writeFileSync(fd, JSON.stringify(ledger, null, 2) + '\n');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    return result;
  } finally {
    try {
      try { unlinkSync(temporary); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    } finally {
      rmdirSync(lock);
    }
  }
}

export function reserve(kind: Provider, model: string | null, purpose: string, path = defaultPath): string {
  return update(path, (ledger) => {
    const row = ledger[kind];
    if (row.used >= caps[kind]) throw new Error('Qualification budget exhausted for ' + kind);
    const id = randomUUID();
    row.used += 1;
    ledger.entries.push({ id, at: wallClock.nowIso(), kind, model, purpose, outcome: 'pending' });
    return id;
  });
}

export function recordOutcome(id: string, outcome: string, path = defaultPath): void {
  update(path, (ledger) => {
    const entry = ledger.entries.find((candidate) => candidate.id === id);
    if (!entry || entry.outcome !== 'pending') throw new Error('Unknown or closed qualification reservation');
    entry.outcome = outcome;
  });
}
