// Owns the SQLite connection and transactional persistence for conversations and turns.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { localDate, type LabAnchor, type LabStore, type WallClock, type Workspace } from '../clock.ts';
import { migrate } from './migrate.ts';
import { clarificationSchema, type Clarification, type EvidenceSource, type Selection } from '../../../shared/events.ts';
import type { StoredSource } from '../evidence/sources.ts';
import { eligibleEpisodes, retrieve, type Episode, type MemoryInput } from '../memory/retrieve.ts';
import { clarificationQuestion } from '../memory/render.ts';

type Origin = 'real' | 'fake' | 'sample';
type Conversation = { id: string; title: string; workspace: Workspace; origin: Origin; updatedLogicalAt: string };
type MessageRow = {
  id: string; role: 'user' | 'assistant'; content: string; status: string; terminalCode: string | null;
  origin: Origin; logicalAt: string; recordedAt: string; tz: string; localDate: string;
  route: string | null; replyTo: string | null; stats_json: string | null;
};
export type Turn = { id: string; conversationId: string; workspace: Workspace; userMessageId: string; assistantMessageId: string; pinnedEpisodeId?: string };
type TurnInput = { conversationId: string; clientTurnId: string; text: string; tz: string; route: string; logicalNow: Date; realNow: string; selection?: Selection };
type Option = Clarification['options'][number] & { episodeMessageId: string };
type ExistingTurn = { turnId: string; status: 'active' | 'done'; assistantMessageId: string };
export type Admission =
  | { kind: 'admitted'; turn: Turn; text: string }
  | { kind: 'duplicate'; existing: ExistingTurn }
  | { kind: 'busy'; turnId: string }
  | { kind: 'missing' | 'invalid' };

export class Repo implements LabStore {
  private readonly db: DatabaseSync;
  private readonly origin: Origin;
  private readonly wall: WallClock;
  constructor(dir: string, fakeMode: boolean, wall: WallClock) {
    mkdirSync(dir, { recursive: true });
    this.origin = fakeMode ? 'fake' : 'real';
    this.wall = wall;
    this.db = new DatabaseSync(join(dir, fakeMode ? 'continuum-fake.db' : 'continuum.db'));
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      if (this.db.prepare('PRAGMA foreign_keys').get()?.foreign_keys !== 1) {
        throw new Error('SQLite foreign keys unavailable');
      }
      this.write(() => {
        migrate(this.db);
        if (!fakeMode) {
          for (const table of ['conversations', 'messages', 'evidence']) {
            if (this.db.prepare("SELECT 1 FROM " + table + " WHERE origin = 'fake' LIMIT 1").get()) {
              throw new Error('Fake rows found in continuum.db (' + table + ')');
            }
          }
        }
        this.db.exec(`UPDATE messages SET status='partial', terminal_code='INTERRUPTED'
          WHERE status='streaming' AND id IN (SELECT assistant_message_id FROM turns WHERE status='active');`);
        this.db.prepare(`UPDATE turns SET status='done', terminal_code='INTERRUPTED', ended_real=?
          WHERE status='active'`).run(this.wall.nowIso());
        this.db.exec("UPDATE attempts SET outcome='INTERRUPTED' WHERE outcome IS NULL;");
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private write<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }

  create(workspace: Workspace, now: string): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO conversations
      (id, workspace, title, origin, created_logical_at, updated_logical_at) VALUES (?, ?, 'New conversation', ?, ?, ?)`)
      .run(id, workspace, this.origin, now, now);
    return id;
  }

  list(workspace: Workspace) {
    return this.db.prepare(`SELECT id, title, origin, updated_logical_at AS updatedLogicalAt
      FROM conversations WHERE workspace=? ORDER BY updated_logical_at DESC, rowid DESC`).all(workspace);
  }

  conversation(id: string): Conversation | undefined {
    return this.db.prepare(`SELECT id, title, workspace, origin, updated_logical_at AS updatedLogicalAt
      FROM conversations WHERE id=?`).get(id) as Conversation | undefined;
  }

  detail(id: string) {
    const conversation = this.conversation(id);
    if (!conversation) return undefined;
    const rows = this.db.prepare(`SELECT id, role, content, status, terminal_code AS terminalCode,
      origin, logical_at AS logicalAt, recorded_at AS recordedAt, tz, local_date AS localDate, route,
      reply_to AS replyTo, stats_json FROM messages WHERE conversation_id=? ORDER BY rowid`).all(id) as MessageRow[];
    const byMessage = new Map<string, EvidenceSource[]>();
    for (const row of this.db.prepare(`SELECT e.* FROM evidence e JOIN messages m ON m.id=e.message_id
      WHERE m.conversation_id=? ORDER BY e.ordinal`).all(id)) {
      const messageId = String(row.message_id);
      const items = byMessage.get(messageId) ?? [];
      items.push({
        ref: 'E' + row.ordinal, url: String(row.url), title: String(row.title ?? ''), domain: String(row.domain),
        domainMatch: row.domain_match === 'exact' ? 'exact' : 'none', entity: String(row.entity ?? ''),
        retrievedAt: String(row.retrieved_at), publishedAt: row.published_at === null ? null : String(row.published_at),
        sentences: JSON.parse(String(row.sentences_json)) as string[],
      });
      byMessage.set(messageId, items);
    }
    const choices = new Map<string, Clarification>();
    for (const choice of this.db.prepare(`SELECT c.id, c.options_json, t.assistant_message_id FROM clarifications c
      JOIN turns t ON t.id=c.turn_id WHERE c.conversation_id=? AND c.consumed=0 AND t.terminal_code='COMPLETED'`).all(id)) {
      choices.set(String(choice.assistant_message_id), clarificationSchema.parse({
        clarificationId: String(choice.id), question: clarificationQuestion, options: JSON.parse(String(choice.options_json)),
      }));
    }
    const messages = rows.map(({ stats_json, ...row }) => ({
      ...row, evidence: byMessage.get(row.id) ?? [], stats: stats_json === null ? null : JSON.parse(stats_json) as unknown,
      clarification: choices.get(row.id),
    }));
    return { conversation, messages };
  }

  delete(id: string) {
    return this.write(() => {
      if (this.activeTurn(id)) return 'busy';
      return this.db.prepare('DELETE FROM conversations WHERE id=?').run(id).changes ? 'deleted' : 'missing';
    });
  }

  activeTurn(conversationId: string) {
    const row = this.db.prepare("SELECT id FROM turns WHERE conversation_id=? AND status='active'").get(conversationId);
    return row?.id as string | undefined;
  }

  admit(input: TurnInput): Admission {
    return this.write(() => {
      const conversation = this.conversation(input.conversationId);
      if (!conversation) return { kind: 'missing' };
      const existing = this.db.prepare(`SELECT id AS turnId, status, assistant_message_id AS assistantMessageId
        FROM turns WHERE conversation_id=? AND client_turn_id=?`).get(conversation.id, input.clientTurnId) as ExistingTurn | undefined;
      if (existing) return { kind: 'duplicate', existing };
      const active = this.activeTurn(conversation.id);
      if (active) return { kind: 'busy', turnId: active };
      const turn: Turn = {
        id: randomUUID(), conversationId: conversation.id, workspace: conversation.workspace,
        userMessageId: randomUUID(), assistantMessageId: randomUUID(),
      };
      let text = input.text;
      let displayedText = input.text;
      if (input.selection) {
        const row = this.db.prepare(`SELECT c.original_text, c.options_json FROM clarifications c JOIN turns t ON t.id=c.turn_id
          WHERE c.id=? AND c.conversation_id=? AND c.workspace=? AND c.consumed=0 AND t.terminal_code='COMPLETED'`)
          .get(input.selection.clarificationId, conversation.id, conversation.workspace);
        if (!row) return { kind: 'invalid' };
        const option = (JSON.parse(String(row.options_json)) as Option[])[input.selection.optionIndex];
        if (!option || !eligibleEpisodes(this.db, { text, workspace: turn.workspace, conversationId: turn.conversationId,
          turnId: turn.id, now: input.logicalNow, tz: input.tz, fakeMode: this.origin === 'fake' }, [], option.episodeMessageId).length) {
          return { kind: 'invalid' };
        }
        turn.pinnedEpisodeId = option.episodeMessageId;
        text = String(row.original_text);
        displayedText = 'Selected: ' + option.label;
        this.db.prepare('UPDATE clarifications SET consumed=1 WHERE id=?').run(input.selection.clarificationId);
      }
      const logicalAt = input.logicalNow.toISOString();
      const epoch = turn.workspace === 'lab' ? this.labAnchor().epoch : null;
      this.db.prepare(`INSERT INTO turns (id, conversation_id, workspace, client_turn_id,
        user_message_id, assistant_message_id, status, lab_epoch, started_real, pinned_episode_id)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .run(turn.id, turn.conversationId, turn.workspace, input.clientTurnId, turn.userMessageId, turn.assistantMessageId, epoch, input.realNow, turn.pinnedEpisodeId ?? null);
      const insert = this.db.prepare(`INSERT INTO messages (id, conversation_id, workspace, turn_id, role, content,
        status, origin, logical_at, recorded_at, tz, local_date, route, reply_to)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const time = [this.origin, logicalAt, input.realNow, input.tz, localDate(input.logicalNow, input.tz), input.route];
      insert.run(turn.userMessageId, turn.conversationId, turn.workspace, turn.id, 'user', displayedText, 'complete', ...time, null);
      insert.run(turn.assistantMessageId, turn.conversationId, turn.workspace, turn.id, 'assistant', '', 'streaming', ...time, turn.userMessageId);
      this.db.prepare(`UPDATE conversations SET title=CASE WHEN title='New conversation' THEN ? ELSE title END,
        updated_logical_at=? WHERE id=?`)
        .run(Array.from(input.text.replace(/\s+/g, ' ')).slice(0, 65).join(''), logicalAt, turn.conversationId);
      return { kind: 'admitted', turn, text };
    });
  }

  recent(turn: Turn): { role: 'user' | 'assistant'; content: string }[] {
    return this.db.prepare(`SELECT role, content FROM messages WHERE conversation_id=?
      AND (role='user' OR status='complete')
      AND turn_id IN (SELECT id FROM turns WHERE conversation_id=? AND id<>? ORDER BY rowid DESC LIMIT 8)
      ORDER BY rowid`).all(turn.conversationId, turn.conversationId, turn.id) as { role: 'user' | 'assistant'; content: string }[];
  }

  memory(input: Omit<MemoryInput, 'fakeMode'>) {
    return retrieve(this.db, { ...input, fakeMode: this.origin === 'fake' });
  }

  clarify(turn: Turn, question: string, episodes: Episode[]): Clarification {
    const clarificationId = randomUUID();
    const options = episodes.map((ep, index) => ({ index, label: ep.title, logicalAt: ep.logicalAt, preview: ep.question.slice(0, 240) }));
    const stored = options.map((option) => ({ ...option, episodeMessageId: episodes[option.index].messageId }));
    this.db.prepare(`INSERT INTO clarifications (id,turn_id,conversation_id,workspace,original_text,options_json) VALUES (?,?,?,?,?,?)`)
      .run(clarificationId, turn.id, turn.conversationId, turn.workspace, question, JSON.stringify(stored));
    return { clarificationId, question: clarificationQuestion, options };
  }

  append(turn: Turn, text: string) {
    this.db.prepare(`UPDATE messages SET content=content || ? WHERE id=? AND status='streaming'`)
      .run(text, turn.assistantMessageId);
  }

  appendSentence(turn: Turn, text: string, refs: string[]) {
    this.write(() => {
      this.append(turn, text);
      const insert = this.db.prepare('INSERT OR IGNORE INTO citations (message_id, ref) VALUES (?, ?)');
      for (const ref of refs) insert.run(turn.assistantMessageId, ref);
    });
  }

  saveEvidence(turn: Turn, sources: readonly StoredSource[], provider: string) {
    this.write(() => {
      const insert = this.db.prepare(`INSERT INTO evidence (id,message_id,ordinal,entity,query,url,title,domain,
        domain_match,sentences_json,published_at,retrieved_at,provider,origin) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const source of sources) insert.run(randomUUID(), turn.assistantMessageId, Number(source.ref.slice(1)),
        source.entity, source.query, source.url, source.title, source.domain, source.domainMatch,
        JSON.stringify(source.sentences), source.publishedAt, source.retrievedAt, provider, this.origin);
    });
  }

  finish(turn: Turn, code: string, status: string, stats: unknown): boolean {
    return this.write(() => {
      const changed = this.db.prepare(`UPDATE turns SET status='done', terminal_code=?, ended_real=?
        WHERE id=? AND status='active' AND (workspace='live' OR lab_epoch=(SELECT epoch FROM lab_state WHERE id=1))`)
        .run(code, this.wall.nowIso(), turn.id).changes;
      if (!changed) return false;
      this.db.prepare(`UPDATE messages SET status=?, terminal_code=?, stats_json=?
        WHERE id=? AND status='streaming'`).run(status, code, JSON.stringify(stats), turn.assistantMessageId);
      return true;
    });
  }

  startAttempt(turn: Turn, provider: string, model: string | null, kind: 'generation' | 'search' = 'generation'): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO attempts (id, turn_id, kind, provider, model, started_real)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, turn.id, kind, provider, model, this.wall.nowIso());
    return id;
  }

  finishAttempt(id: string, outcome: string, latency: number, status?: number) {
    this.db.prepare('UPDATE attempts SET outcome=?, latency_ms=?, http_status=? WHERE id=?')
      .run(outcome, Math.round(latency), status ?? null, id);
  }

  labAnchor(): LabAnchor {
    const row = this.db.prepare('SELECT logical_anchor, real_anchor, epoch FROM lab_state WHERE id=1').get();
    if (!row || typeof row.epoch !== 'number') throw new Error('Timeline Lab state is missing');
    return {
      logical_anchor: typeof row.logical_anchor === 'string' ? row.logical_anchor : null,
      real_anchor: typeof row.real_anchor === 'string' ? row.real_anchor : null,
      epoch: row.epoch,
    };
  }

  setLabStart(target: string, realNow: string) {
    this.write(() => {
      if (this.db.prepare("SELECT 1 FROM messages WHERE workspace='lab' LIMIT 1").get()) throw new Error('Lab is not empty');
      this.db.prepare('UPDATE lab_state SET logical_anchor=?, real_anchor=? WHERE id=1').run(target, realNow);
    });
  }

  advanceLab(target: string, realNow: string, logicalNow: string) {
    this.write(() => {
      const latest = this.db.prepare("SELECT max(logical_at) AS value FROM messages WHERE workspace='lab'").get()?.value;
      if (target < logicalNow || (typeof latest === 'string' && target < latest)) throw new Error('Lab time must move forward');
      this.db.prepare('UPDATE lab_state SET logical_anchor=?, real_anchor=? WHERE id=1').run(target, realNow);
    });
  }

  resetLab(realNow: string) {
    this.write(() => {
      this.db.exec("DELETE FROM conversations WHERE workspace='lab'");
      this.db.prepare('UPDATE lab_state SET logical_anchor=?, real_anchor=?, epoch=epoch+1 WHERE id=1').run(realNow, realNow);
    });
  }
}

// Diagnostic access for offline SQLite checks without exposing the app connection.
export { DatabaseSync as DiagnosticDatabase };
