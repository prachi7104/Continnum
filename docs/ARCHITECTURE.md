# Continuum: architecture

*Status: **FROZEN v1.1**, 2026-11-18. v1.1 applies the independent-review findings F01–F20 and E01–E05 (see `CORRECTIONS-v1.1.md`). v1.0 is kept unchanged in `v1.0/`. Requirement IDs (R#) refer to CONTINUUM-SPEC.md. Where this file conflicts with the 2026-11-17 convergence report, this file wins.*

**Phase tags.** Each section says when it must be built: **[P0–1]** means Phase 0 or Phase 1 (Codex builds it now). **[Later]** means a contract for Phases 2–5. Do not build [Later] items early, but do not violate them in the schema or interfaces either.

## 1. Overview

```
React client (Vite) ── POST /api/conversations/:id/turns ──► Hono server on 127.0.0.1 (Node ^22.13 || ^24)
      ▲   text/event-stream: typed, validated events                 │
      │                                                              ▼
      │   TurnEngine: the ONLY orchestrator (§6). AbortSignal = client abort ∪ deadline (monotonic)
      │    ① Admission (transaction): turn row, user message, assistant placeholder (§10.1)
      │    ② Pre-pass, code only: LogicalClock → TemporalResolver → CueDetector → MemoryRetriever → Router
      │         outcomes: DIRECT_ANSWER (0 gen) | CLARIFY (0 gen) | MODEL_PATH (chat_plain | undecided | research | recall_synth | reverify)
      │    ③ Generation loop: one streamText call per generation, tools have NO execute (§6.3)
      │    ④ Release gate (§7): withhold unsupported checkable claims; validate comparisons (§8)
      │    ⑤ Finalise (finally): exactly one durable terminal state; ≤ 1 terminal SSE event
      ▼
   SQLite via node:sqlite (WAL, foreign_keys=ON), behind server/src/db/repo.ts
```

**Design principle.**
- **Code owns:** dates, memory selection, ambiguity, missing-memory statements, routing class, step admission, tool execution, budgets, retries and fallback, verdicts, counts, coverage.
- **The model owns:** which queries to run (within budget), reformulation, and language.

The model never chooses which past conversation is "the one". It only works with candidates that code selected.

## 2. Modules [P0–1 creates the files marked *]

| Path | Responsibility |
|---|---|
| `shared/events.ts` * | zod schemas for SSE events and API DTOs, shared by client and server |
| `server/src/clock.ts` * | `LogicalClock` (Live, Lab), `WallClock`, `Monotonic` (§3). The only module that reads system time |
| `server/src/db/{schema.sql,migrate.ts,repo.ts}` * | Schema, automatic init and recovery on boot; the only module that imports `node:sqlite` |
| `server/src/temporal/resolve.ts` | Pure: (text, now, tz) → UTC half-open intervals, alternates, flags |
| `server/src/memory/{cues.ts,retrieve.ts,render.ts}` | Cue lexicon; retrieval → MemoryResult; deterministic recall rendering |
| `server/src/engine/{route.ts,turn.ts,budget.ts}` * | Routing, the generation loop (sole orchestrator), budget accounting. Phase 1 builds `turn.ts` and `budget.ts` for `chat_plain` only |
| `server/src/llm/{provider.ts,gemini.ts,fake.ts,prompts.ts}` * | `ModelProvider`, fallback chain, fake provider |
| `server/src/search/{provider.ts,tavily.ts,fake.ts,executor.ts}` * | `SearchProvider`; Phase 1 builds provider + adapters; executor is Phase 2 |
| `server/src/evidence/{sentences.ts,select.ts}` | Sentence addressing; per-entity evidence selection (§7.2) |
| `server/src/validate/{citations.ts,release.ts,compare.ts,values.ts}` | Release gate, comparison verdicts, value and qualifier normalisation |
| `server/src/api/{routes.ts,sse.ts}` * | HTTP and SSE |
| `scripts/doctor.ts`, `scripts/budget-ledger.ts` * | Provider qualification with a persisted request ledger (§9.3) |
| `client/src/…` * | UI (§11) |

## 3. Clocks, workspaces and Timeline Lab

### 3.1 Three clocks (F18) [P0–1]

| Clock | API | Used for | Never used for |
|---|---|---|---|
| `LogicalClock` | `now(workspace): Date` | Conversation time: `logical_at`, date resolution, memory | Deadlines, latency, evidence time |
| `WallClock` | `nowIso(): string` | Real timestamps: `recorded_at`, `retrieved_at`, `turns.started_real`, attempts | Memory or date logic |
| `Monotonic` | `ms(): number` (`performance.now()`) | Deadlines, timeouts, all latency stats | Anything persisted as a date |

- Only `clock.ts` calls `Date.now()`, `new Date()` or `performance.now()`. Tests inject fakes for all three.
- The turn deadline is `AbortSignal.any([request.signal, AbortSignal.timeout(TURN_DEADLINE_MS)])` plus `Monotonic` checks for remaining budget. **Simulated time never affects a deadline or a latency number.**
- All persisted timestamps are UTC ISO strings in one fixed format, `YYYY-MM-DDTHH:mm:ss.sssZ`, so string order equals time order.

### 3.2 Workspaces and Lab semantics [P0–1 for the clock; Lab UI Later]

There are two workspaces: `live` (the default) and `lab`.

- **Live:** `logical_at == recorded_at == real now`.
- **Lab:** logical time = `lab_state.logical_anchor + (realNow − lab_state.real_anchor)`.
  - **Set start date:** allowed only while the Lab has no messages. Any date, past or future (this is how the official "3 November" scenario is staged; EVALUATION §5).
  - **Advance** (+1 day, +1 week, or to a date) moves forward only. A target earlier than the latest lab message is rejected.
  - **Reset** deletes `workspace='lab'` conversations (cascades remove everything owned, §4), increments `lab_state.epoch` and sets the anchor to real now.
  - The OS clock and real timestamps are never changed.

**Concurrency (F16) [Later, schema P0–1].**
- Lab mutations (set start, advance, reset, load sample) take an in-process Lab mutex and are rejected with `409 LAB_BUSY` if any `lab` turn is active.
- Lab turn admission is rejected with `409 LAB_BUSY` while a mutation holds the mutex.
- Every turn records the `lab_epoch` at admission. Finalisation updates rows only `WHERE turn_id=? AND lab_epoch = (SELECT epoch FROM lab_state)`, in one transaction. A stale completion after a reset therefore writes nothing; the turn row was already removed by the cascade, and the engine logs `stale_completion_discarded`.

### 3.3 Four times, never substituted (F04)

| Field | Meaning | In Lab |
|---|---|---|
| `messages.logical_at` | Conversation time, used for all memory and date logic | Simulated |
| `messages.recorded_at` | Real wall clock at insert | Real |
| `evidence.retrieved_at` | Real fetch time | **Always real** |
| `evidence.published_at` | Provider estimate, nullable, never invented | As provided |

- Web search always runs against the real web, now.
- Banner while logical and real dates differ: "Simulated date Tue 24 Nov 2026 · Web results are fetched live on {real date}. Timeline Lab simulates when you asked, not the past internet."
- **Change intervals are computed only from real timestamps** (`retrieved_at`, `published_at`), never from `logical_at` (§8.5).
- **Sample data** (`fixtures/lab-sample.json`) is stored with `origin='sample'` and badged "Sample" everywhere (§12).

## 4. Data model [P0–1: the whole schema is created in Phase 1, even tables used later]

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;          -- set on every connection; boot asserts PRAGMA foreign_keys = 1 or exits

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
```

**Referential integrity (F15).**
- The composite FK `(conversation_id, workspace)` makes a message, turn or clarification in a different workspace from its conversation impossible (verified: insert rejected).
- Deleting a conversation, or Lab reset, removes its turns, messages, evidence, citations, comparisons, attempts, clarifications and FTS entries. A test asserts zero orphan rows in each table and runs `INSERT INTO messages_fts(messages_fts) VALUES('integrity-check')`.
- A retry creates a new turn and assistant message. Earlier messages are never rewritten.

**Startup recovery (F13) [P0–1].** On boot, inside one transaction:
- every `turns.status='active'` becomes `done` with `terminal_code='INTERRUPTED'`;
- its assistant message `streaming` becomes `partial` (text kept, possibly empty) with the same code.

This releases the durable lock. Recovered messages are visible but never baseline-eligible (§5.5).

## 5. Temporal resolution and memory (C3, F01, F02, F11, F12, F17)

### 5.1 Resolver (deterministic, pure) [Later; fixtures P0]

The resolver handles:
- named and ISO dates;
- today and yesterday;
- "N days or weeks ago";
- weekday forms ("on Monday", "last Tuesday");
- the compound weekday forms "the Monday before this one" and "Monday before last" (E01);
- this or last week (weeks start Monday);
- this or last month;
- "in October";
- "since X", which gives an interval from X to now;
- "since our last discussion" / "last time" (§5.4).

Rules (E01):
- **A date with no year resolves to its most recent occurrence on or before today** (memory is about the past). Examples, with now = 17 Nov 2026: "30 December" → 30 Dec 2025; "20 November" → 20 Nov 2025.
- **A date with an explicit future year** gives no interval and the flag `future`.
- "Monday" means the most recent Monday, including today.
- "Last Tuesday" means the most recent Tuesday before today. If that Tuesday is in the current week, the previous week's Tuesday is returned as an **alternate**.
- "The Monday before this one" and "Monday before last" both mean the "Monday" date minus 7 days.
- Hours and times of day are not resolved. "At noon" is ignored, and the day interval is used.

**Output (F02).** Each requested local day `[d 00:00, d+1 00:00)` in the request's IANA tz becomes a **UTC half-open interval** `[startUtc, endUtc)`, computed per boundary (so 23- and 25-hour DST days are correct). Retrieval filters `logical_at >= startUtc AND logical_at < endUtc` on `ix_msg_ws_logical`. `local_date` is never the filter. The same stored message can therefore fall on different local days under different request tzs (EVALUATION Q18–Q20).

### 5.2 Memory states

`MemoryResult.state` takes exactly one value. The evaluation predicate **FOUND\*** means `FOUND_WITH_BASELINE ∨ FOUND_NO_BASELINE` (E03).

| State | Condition | User-facing behaviour (written by code) |
|---|---|---|
| `NOT_REQUESTED` | No temporal expression and no memory cue | — |
| `EMPTY_RANGE` | Explicit interval with 0 eligible episodes (alternates included) | Categorical and true: "I have no conversations from Wed 12 Nov." Lists the 3 nearest active local days (closer first; ties → earlier day). |
| `NO_CONFIDENT_MATCH` | Episodes exist but none passes the confidence rule (§5.3) | **Not categorical**: "I found chats on Tue 10 Nov about Postgres hosting and trip packing, but nothing about Kafka." Without a date: "I couldn't find a matching past conversation (searched 14)." |
| `AMBIGUOUS` | The request needs exactly one referent and the tie rule (§5.3) fires | `clarify` event (0 generations, §10.4) |
| `FOUND_NO_BASELINE` | The episode exists, but its answer is not baseline-eligible (§5.5) or has no checkable statements | Says why, then answers the current part without inventing a "then" |
| `FOUND_WITH_BASELINE` | Eligible answer with checkable statements | Proceeds (B or D) |
| `ERROR` | Retrieval threw | "My memory lookup failed." Never "no record". |

### 5.3 Retrieval algorithm [Later]

**Eligibility boundaries, applied in SQL before any ranking (F11):**
- `workspace = :ws`;
- `logical_at < :turnLogicalNow`;
- `turn_id IS NOT :currentTurnId`, which excludes the current user message and its placeholder;
- the requested UTC intervals, when present;
- `origin != 'fake'` unless fake mode is on (§12).

Episodes are a user message plus its `reply_to` assistant message. They are kept as a unit if the user message is eligible.

**Topic terms.** `T` = query tokens minus stopwords, date words and cue words ("answer", "discussion", "asked", "still", "changed", …), porter-stemmed and deduplicated.

**FTS5 scoring (F01).** SQLite's `bm25()` returns values where **lower (more negative) is better** (sqlite.org/fts5.html §5.1.1.2; verified locally: matches are negative). Code uses `rel = -bm25(messages_fts)`, so higher is better, and **only for ordering among already-confident candidates**. bm25 values are not normalised, depend on corpus size, and are never interpreted as confidence or compared by ratio.

**Confidence rule (deterministic, testable).** For each eligible episode, `matched(ep)` = the number of terms of `T` present in it (one FTS `MATCH` per term, restricted to the eligible rowid set).
- With an explicit interval: confident if `matched ≥ 1`.
- Without an interval: confident if `matched ≥ need(|T|)`, where `need = |T|` when `|T| ≤ 2`, else `ceil(|T|/2)`.
- Order confident episodes by `matched` desc, then `rel` desc, then `logical_at` desc.

```ts
retrieve(msg, turn, ws): MemoryResult
  t = resolve(msg, turn.logicalNow, turn.tz); cue = cues(msg); T = topicTerms(msg)
  if (turn.pinnedEpisodeId) return fromPinned(turn.pinnedEpisodeId)            // §10.4, no re-search
  if (!t.intervals && !cue.any) return NOT_REQUESTED
  if (cue.anaphora && referentInCurrentConversation(turn)) return NOT_REQUESTED // working context
  if (cue.sinceLast) return lastDiscussion(turn, T)                              // §5.4
  eps = eligibleEpisodes(ws, turn, t.intervals)                                  // boundaries above
  if (t.intervals && !eps.length && t.alternates) { eps = eligibleEpisodes(ws, turn, t.alternates); usedAlternate = true }
  if (t.intervals && !eps.length) return EMPTY_RANGE{nearest: nearestActiveDays(3, turn.tz)}
  if (!T.length) return FOUND(eps)                         // "what did I ask on 3 Nov?" → all of them
  hits = confident(eps, T, t.intervals ? 'interval' : 'open')
  if (!hits.length) return NO_CONFIDENT_MATCH{topics: titles(eps), searched: eps.length}
  groups = t.intervals ? mergeSharingAnyMatchedTerm(hits)  // same-day CRM chats → one group
                       : groupByConversation(hits)
  if (cue.needsSingleReferent && groups.length ≥ 2 && groups[0].matched === groups[1].matched)
    return AMBIGUOUS(groups.slice(0, 4))
  return FOUND(groups[0] + same-group episodes)
  // Adjacent expansion (±1 episode) stays inside the same conversation and the same eligibility boundaries (F11).
  // FOUND → WITH/NO_BASELINE via §5.5. Budget: ≤ 6 episodes, ≤ 6k tokens, sentence-boundary cut, `truncated` flag.
```

**Ambiguity heuristic (defined and tested).**
- It fires only for requests that need one referent (reverification, "that answer").
- It fires only when the top two groups tie on `matched`.
- bm25 never breaks a tie into a false certainty.
- Fixture coverage: Q05 (same-day merge, not ambiguous), Q06, Q07, Q12, Q14 (tie → AMBIGUOUS), and P01–P15.

Embeddings stay deferred. They are proposed only if the expanded paraphrase suite fails its gate (EVALUATION §3.3).

### 5.4 "Since our last discussion" (F12) [Later]

The referent is the **newest relevant completed episode before the current request**, ordered by `logical_at`, never by conversation ID.
- **With topic terms:** the newest confident episode (open rule), in any conversation, including earlier episodes of the current conversation.
- **Without topic terms:**
  1. If the current conversation has earlier completed episodes, use the newest of them.
  2. Otherwise, use the newest completed episode in the workspace. If another episode from a different conversation lies within 24 h of logical time of it and shares no topic term with it, return `AMBIGUOUS`.
- "Since" then means the interval from that episode's `logical_at` to now.

### 5.5 Baseline eligibility (F17)

- Only assistant messages with `status='complete'` and `origin != 'fake'` are **baseline-eligible**. Sample rows are eligible inside the Lab, and labelled as sample.
- Partial, cancelled, errored and recovered answers stay visible in history and in recall listings (shown with "stopped before finishing"). They are never H-cited as a factual baseline. Such an episode yields `FOUND_NO_BASELINE` with reason `incomplete_answer`.
- **The user's question always counts** for "what did I ask", whatever the answer's status. Completed questions and the factual claims in their answers are separate things.

### 5.6 Deterministic recall (0 generations) [Later]

For pure recall in state `FOUND*` or `EMPTY_RANGE`, `memory/render.ts` builds the whole answer:
- each question with its local time in the request tz;
- the first two sentences of each eligible answer, or "(stopped before finishing)";
- an "open" link.

There is no model call. This also works without API keys. Recall that needs synthesis makes 1 generation, constrained to H-citations and released through the gate in §7.

## 6. Turn engine (C1, F06, F07)

### 6.1 Single orchestration owner (F06) [P0–1 for chat_plain]

**`engine/turn.ts` is the only owner of:**
- step admission;
- tool execution;
- search budgets;
- retry and fallback budgets;
- tool-result message construction;
- final synthesis.

The AI SDK is used only as a single-step transport:
- **One generation = one `streamText` call** with `stopWhen: isStepCount(1)`, `maxRetries: 0`, `abortSignal`.
- The `web_search` tool is declared with `description` and `inputSchema` but **no `execute`**, so the SDK never runs it. (The docs say such tools "will not be executed automatically"; Phase 0 confirms the stream ends with the tool-call parts and no SDK-run results.)
- After a step with tool calls, the engine:
  1. appends the step's `response.messages` (the assistant message with its tool-call parts);
  2. executes the admitted calls through `search/executor.ts`;
  3. appends **one `tool` message with a `tool-result` part for every `toolCallId`**: real results, `error` results for failed searches, and `{skipped:'budget'}` for calls over budget. This keeps the provider protocol valid.
- `prepareStep`, `hasToolCall` and SDK multi-step loops are **not used**. Nothing runs a tool through two paths.

### 6.2 Routing (F07) [Later, except chat path in P1]

Code computes a route class before any generation:

| Class | Trigger (code lexicon, tested) | Generation 1 | Streaming |
|---|---|---|---|
| `DIRECT_ANSWER` | Deterministic recall, or a missing-memory-only request | none | Code text, emitted whole |
| `CLARIFY` | `AMBIGUOUS` | none | Code text + options |
| `chat_plain` | Social or meta lexicon (greeting, thanks, "who are you") **and** no current-info cue | No tools passed | `answer.delta` tokens directly |
| `research` | A current-info cue: latest, current, now, today, price, pricing, cost, release, version, news, announce, CEO, "still", "this week/month", a year ≥ the current year − 1; or a FOUND\* reverification | `toolChoice:'required'` (gen 1 only; a non-final gen 2 uses `auto`) | Progress events live; answer through the gate (§7.1) |
| `undecided` | Anything else (e.g. "explain B-trees") | `toolChoice:'auto'` | **Text is held** until the step ends. If it ends with tool calls, the held text is discarded unseen; if it ends without tool calls, the text is released through the gate. Latency is measured, not assumed (§14). |
| `reverify` | `FOUND_WITH_BASELINE` + reverify cue, or an explicit current target with missing memory (then `research` + a code-written "no earlier record" line) | `toolChoice:'required'` | Validated `comparison.item` events (§8) |

- **An explicit current-information question never receives a model-only answer.**
- If search is unavailable (no Tavily key, 432, or all searches failed), the answer starts with the code-written line "I couldn't search the web, so I can't confirm current facts." Checkable claims are then withheld by the gate.
- **Phase 1** builds the route classifier and only the `chat_plain` path:
  - Turns classed `research` or `undecided` are answered by the plain chat path, but **prefixed by a code-written line**: "Web research isn't built into this version yet; this answer comes from the model alone and may be out of date." The turn's `route` is stored as classified.
  - The answer is never silently stale, and there is no fake search.
  - Phase 2 removes this line along with the fallback.

### 6.3 Generation counts and budget (C1) [Later; budget.ts skeleton P1]

| Path | Generations | Search rounds | Queries |
|---|---|---|---|
| Direct answer / clarify | 0 | 0 | 0 |
| Recall synthesis | 1 | 0 | 0 |
| `chat_plain`, or `undecided` with no search | 1 | 0 | 0 |
| Research, 1 round | 2 | 1 | ≤ 6 |
| Research, 2 rounds | 3 | 2 | ≤ 10 total |
| Reverify (D) | 2 | 1 | ≤ 8 + coverage top-up ≤ 2 (§7.2) |

**Hard budget per turn (`engine/budget.ts`):**
- Generations ≤ 3.
- Search rounds ≤ 2 (≤ 1 for D).
- Queries ≤ 10, deduplicated after normalisation.
- **Physical provider attempts ≤ generations + 2**, counted before dispatch. `maxRetries: 0` means the SDK makes no hidden retries.
- Deadline 30 s, monotonic.

**Final generation.** A generation is final if:
- it is the 3rd;
- it is the 2nd in D;
- the round budget is used up;
- or ≤ 8 s of the deadline remain.

It runs with `toolChoice:'none'` and tools still declared, which keeps the tool history valid. If a tool call still comes back, the engine makes one attempt with tools omitted entirely; Phase 0 qualifies which variant each model accepts. If that also fails: `turn.error{UNRESOLVED_TOOL_CALL}` with the collected evidence shown as a source list. **A turn never ends silently with a pending tool call.**

Stats: `{generations, attempts[], searches, rounds, modelUsed[], route, tFirstProgressMs, tFirstAnswerTextMs, tTotalMs}`. All timings are monotonic.

### 6.4 Loop (sketch)

```ts
const msgs = context(system(logicalNow, tz, ws), recentTurns(≤8), memoryBlocks(untrusted))
for (let gen = 1; ; gen++) {
  const final = budget.isFinal(gen, route, monotonic)
  const step = await provider.generate({ messages: msgs,
      tools: route === 'chat_plain' ? undefined : { web_search: searchToolNoExecute },
      toolChoice: final ? 'none' : firstChoice(route, gen),
      output: final && route === 'reverify' ? Output.array({ element: ComparisonItem }) : undefined,
      maxRetries: 0, signal })                                  // fallback chain §9, attempts counted before dispatch
  if (!step.toolCalls.length) return gate.release(step, route)  // §7
  if (final) return resolveStrayToolCall(step)                  // §6.3
  const admitted = budget.admitQueries(step.toolCalls)          // dedupe, cap; rest → skipped
  const results = await executor.run(admitted, signal)          // allSettled, concurrency 6, real progress events
  msgs.push(...step.responseMessages, toolResultMessage(step.toolCalls, results))  // every toolCallId answered
  evidence.add(results)
}
```

## 7. Grounding, validation and release (C2, C5, F08, F09, F10) [Later]

### 7.1 Release gate (F08)

**Evidence format.**
- Search results become `E<n>`, with sentences `E<n>.<k>`. Recalled answers become `H<shortId>.<k>`.
- Both are passed inside `<untrusted_source id=…>` blocks, with tag-like sequences escaped. The system prompt says this is data, not instructions.
- The model cites references, never URLs.

**Sentence classes** (code heuristic, tested; deliberately imperfect):
- **checkable**: contains a digit, currency, %, a version, a date, or a "X is the CEO/price/limit…" pattern;
- **plain**: everything else.

**Policy for research, recall synthesis and released `undecided` text:**

| Sentence | Released as |
|---|---|
| checkable, with ≥ 1 valid ref of the right side and the claimed value present in a cited sentence | `answer.sentence{refs, support:'sourced'}` |
| checkable, without that | **Withheld.** At the end, code adds one line: "I left out N statements I couldn't support with the sources I found." The count is stored. |
| plain, with valid refs | `support:'sourced'` |
| plain, no refs | `support:'no_source'`, visibly labelled "no source" |

- Released sentences are never retracted.
- UI and docs use the words "sourced" / "no source" / "left out". Never "verified" or "fact-checked".
- The gate checks structure (refs exist, value strings appear). **It does not establish that a source semantically supports a sentence.**

### 7.2 Source selection and coverage (F09, F10)

- Tavily request, explicit: `search_depth:'basic'`, `max_results:5`, `chunks_per_source:3`, `include_published_date:true`. No `auto_parameters`, no `time_range` for current-state queries.
- **Domain match (F09).** `domain_match='exact'` only when the registrable domain's first label equals the normalised entity name (`neon.tech` for "Neon"). UI wording: "site name matches". It is **never called first-party or official**, and never used to resolve conflicts. No curated product database.
- **Per-entity coverage (F10).** Code keeps a coverage table: requested → queried → evidence found → supported in output.
  - Each search call's `inputSchema` includes `entity`.
  - Selection first gives each requested entity its best source, then a second source each while the budget allows, then fills by score.
  - Context cap: max(8, number of entities) sources, ≤ 12, with 3 sentences each (2 when more than 8 sources).
  - If an entity has no evidence after round 1 and budget remains, code may issue **one top-up query per uncovered entity** (≤ 2 total).
  - An entity still uncovered appears in the output as "couldn't find current sources for X". It is never silently omitted.

### 7.3 Streaming summary

| Path | Streaming |
|---|---|
| `chat_plain` | Tokens directly (`answer.delta`) |
| Direct answer, clarify | Code text, whole |
| `research`, recall synthesis | Real progress events; then gated sentences |
| `undecided` | Held until the step ends; then gated sentences, or discarded if a tool was called |
| `reverify` | Validated `comparison.item` events; headline last |

## 8. Reverification (Path D) (F03, F04) [Later]

Claims are derived on demand from the immutable baseline answer. There is no permanent claim ledger.

### 8.1 Item schema (model output)

```ts
const Side = z.object({
  value: z.string(),                       // as stated: "$19/user/month", "v24.11.0", "Thomas Dohmke"
  numericClaim: z.number().nullable(),     // model's reading; code re-derives (§8.2)
  currency: z.string().nullable(), unit: z.string().nullable(),
  period: z.enum(['month','year','one_time','usage','none']).nullable(),
  variant: z.string().nullable(), region: z.string().nullable(),
  conditions: z.array(z.string()).max(4),  // "billed annually", "first 3 months"
  cites: z.array(z.string()).min(1) })
const ComparisonItem = z.object({
  entity: z.string(), attribute: z.string(),
  baselineRefs: z.array(z.string()).min(1),            // which H sentences this item checks
  then: Side.nullable(), nowObservations: z.array(Side).max(4),
  modelVerdict: z.enum(['changed','unchanged','incomparable','conflicting','new','unverified']),
  note: z.string().max(240) })
```

### 8.2 Normalisation by code (`validate/values.ts`)

- **Numbers are derived from `value` and from the cited sentence text**: currency symbol or code, scale (k, M, B, "thousand"), decimals, and ranges are kept as ranges. The model's `numericClaim` is only cross-checked. On a mismatch, code uses the derived number and adds reason `numeric_claim_mismatch`. If nothing can be derived, the value is treated as non-numeric.
- **Value presence:**
  - `then.value` must appear, after normalisation, in a cited **H** sentence that is baseline-eligible (§5.5);
  - each `now` value must appear in a cited **E** sentence from **this turn's** evidence.
  - Wrong-side or foreign refs are removed. A side with no remaining valid cite is unsupported.
- **Essential qualifiers for money values:** `currency` and `period`, plus `variant` if either side states one. Material, non-essential: `unit`, `region`, `conditions`.

### 8.3 Comparability

For each qualifier key, comparing then with now:

| Then | Now | Effect |
|---|---|---|
| known | known, equal | comparable on that key |
| known | known, different | `incomparable` (reason `qualifier_mismatch:<key>`) |
| an essential key unknown on either side | — | `incomparable` (reason `qualifier_unknown:<key>`). **Equal numbers with unknown essentials are not "unchanged"; different numbers are not "changed".** |
| a material non-essential key known on one side only | — | Verdict allowed; reason `qualifier_unconfirmed:<key>` is shown on the row |

### 8.4 Verdict rules (code; the first match wins)

Preparation:
1. **Deduplicate** items by `normalise(entity) + normalise(attribute) + normalise(variant)`, merging observations and cites.
2. Keep only **supported** current observations (§8.2).
3. Group them by normalised value, among those comparable to each other.

| # | Condition | Verdict |
|---|---|---|
| 1 | No supported current observation | `unverified` (reason: `no_current_source`, `search_failed`, or `not_returned_by_model`) |
| 2 | `then` missing or unsupported | `new` if the user asked what is new; otherwise `unverified` with reason `no_earlier_value` |
| 3 | Supported observations exist, but none is comparable to `then` (§8.3) | `incomparable` |
| 4 | ≥ 2 comparable observations with different normalised values | `conflicting` (all values shown; no domain-based tie-break) |
| 5 | Exactly one comparable current value | equal → `unchanged`; different → `changed` |

- If the model's verdict differs from the code's, code wins. The disagreement is counted in stats.
- **"No news found" never produces `unchanged`.**

### 8.5 Coverage and the headline

- **The denominator is code-derived:** every checkable baseline H sentence, plus every entity named in the user's current request.
- Any H sentence not covered by a returned item gets a code-created row with `unverified` and `not_returned_by_model`.
- Entities whose searches failed get rows with `search_failed`.
- **The headline counts every requested row**, e.g. "Checked 5 · 1 differs · 1 unchanged · 1 not comparable · 2 couldn't confirm". A model that drops a hard item cannot improve it.

### 8.6 What a "change" means (F04)

Each `changed` or `unchanged` row carries a code-assigned **basis**:

| Basis | Condition | Wording |
|---|---|---|
| `claim_only` | The Then side is supported only by the earlier assistant answer (no historical E evidence) | changed → "**Differs** from my earlier answer: I said X; current sources say Y." unchanged → "Current sources agree with my earlier answer." |
| `evidence` | The baseline answer cited historical evidence rows whose sentences contain the then-value | changed → "Sources fetched {then retrieved_at} said X; sources fetched {now retrieved_at} say Y." |

- A difference with basis `claim_only` may mean the earlier answer was wrong, not that the world changed. The UI says so in the row tooltip.
- **Intervals use real time only:** from the historical evidence's `retrieved_at` to the current `retrieved_at`. If that interval is under 24 h (typical in Lab demos), the row says "fetched {minutes/hours} apart; this shows a difference between retrievals, not a dated change".
- A specific change date is shown only when a current E sentence states one, with `published_at` ≥ the historical `retrieved_at` and ≤ now (real).
- `logical_at` labels the Then side ("What I told you on Mon 16 Nov", plus "(simulated date)" in Lab). It never enters an interval, so a future simulated date cannot create an impossible interval.

## 9. Providers, fallback and qualification (F05)

### 9.1 Interfaces [P0–1]

- `ModelProvider.generate(req, signal)` and `SearchProvider.search(q, signal)`. Implementations: `gemini` (`@ai-sdk/google`), `tavily` (REST via `fetch`), `fake`.
- Every SDK call passes `maxRetries: 0`. The fallback chain is the only retry mechanism.
- Model order comes from `CONTINUUM_MODELS`, set from Phase 0 measurements. Candidates (free tier per Google docs, 2026-11-17): `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`.

### 9.2 Fallback rules [P1]

- Fall back only on 404/model-not-found, 429, 5xx, a network error, or no first byte within 8 s (monotonic).
- **Never** fall back on 400, 401/403 (`CONFIG_ERROR`) or a safety block.
- Each physical attempt is counted **before dispatch** against the turn budget and written to `attempts`. A fallback starts only if ≥ 6 s remain.
- All attempts failed → `turn.error{PROVIDER_UNAVAILABLE}`. The user message is kept.
- **Error-path tests use mocks only** (`MockLanguageModelV4`, mocked `fetch`). No deliberate invalid-key live calls.

### 9.3 Qualification and the budget ledger [P0]

- `scripts/budget-ledger.ts` keeps `docs/qualification-ledger.json`, which is committed: `{gemini:{cap:24, used}, tavily:{cap:5, used}, groq:{cap:0, used}, entries:[{at, kind, model, purpose, outcome}]}`.
- Each request is **recorded before dispatch**, and dispatch is refused when `used == cap`.
- Quick and full doctor runs share this one ledger. It is never reset by code; a reset would show in the git diff, and only the owner may approve it.
- Doctor qualifies the execution contract:
  - availability and streaming;
  - **single-step tool calling with no `execute`**, including ≥ 2 parallel calls in one step;
  - the final generation with the tool history and `toolChoice:'none'`;
  - the variant with tools omitted;
  - `Output.array` structured output;
  - cancellation mid-stream (abort observed, no further chunks);
  - first-chunk and total latency.
- Exact request plan: IMPLEMENTATION-PLAN §Phase 0.
- With no keys, doctor completes all offline checks and reports `qualification: BLOCKED (missing GEMINI_API_KEY / TAVILY_API_KEY)`.
- Doctor states that it cannot detect billing; use an AI Studio key from a project without billing.

### 9.4 Search failures [Later]

- 429: honour `Retry-After` once, if ≤ 3 s and within budget. It counts as another credit.
- 432 (plan limit): `SEARCH_UNAVAILABLE`, and the code-written line from §6.2.

## 10. API, events and turn lifecycle (F13, F14, F19)

### 10.1 Admission and idempotency (F14) [P1]

```
POST /api/conversations/:id/turns   {text (≤8000), tz, clientTurnId, selection?}  → text/event-stream
     409 TURN_IN_PROGRESS {turnId} · 409 DUPLICATE_TURN {turnId, status, assistantMessageId}
     409 LAB_BUSY · 422 INVALID_TZ · 422 INVALID_SELECTION · 413 body > 32 KB
```

One transaction:
1. Look up `(conversation_id, client_turn_id)`. If found → `409 DUPLICATE_TURN` with the existing turn's state. **No new message, no provider call.**
2. Insert the `turns` row (`status='active'`). If `ux_one_active_turn` fails → `409 TURN_IN_PROGRESS`.
3. Insert the user message and the assistant placeholder (`streaming`).

Only after commit does the engine start. The in-process lock map mirrors the durable index for fast rejection.

### 10.2 Terminal guarantees (F13) [P1]

- **Exactly one durable terminal state per admitted turn.** `finally` sets `turns.status='done'` and `terminal_code`, and the assistant message status, in one transaction. Startup recovery covers process death (§4).
- **At most one terminal SSE event per connection** (`turn.completed`, `turn.error` or `clarify`), sent only while the connection is open.
- **No delivery is guaranteed after a client disconnect.** The client reloads state via `GET /api/conversations/:id`.
- **Abort mechanism:** Hono `streamSSE` with `stream.onAbort()`, plus `c.req.raw.signal`, combined into the engine signal. Phase 1 verifies on `@hono/node-server` 2.1.9 that a real socket close fires it.
- **Terminal codes:**

| Code | Cause | Message status |
|---|---|---|
| `COMPLETED` | Normal end | `complete` |
| `CANCELLED` | Client abort (Stop, or disconnect) | `cancelled`, partial text kept |
| `DEADLINE` | Monotonic deadline hit | `partial` |
| `PROVIDER_UNAVAILABLE`, `SEARCH_UNAVAILABLE`, `CONFIG_ERROR`, `NOT_CONFIGURED`, `UNRESOLVED_TOOL_CALL`, `INTERNAL` | Provider or app failure | `error` (partial text kept) |
| `INTERRUPTED` | Process died; set by startup recovery | `partial` |

- After any terminal path, the lock is released and the next turn is admitted.

### 10.3 Other endpoints

```
GET  /api/health                 {ok, node, db, providers:{model:'ready'|'missing_key'|'fake', search:…}, lab:{enabled}, fakeMode}
GET  /api/conversations?workspace=     [{id,title,origin,updatedLogicalAt}]
POST /api/conversations          {workspace} → {id}
GET  /api/conversations/:id      {conversation, messages[{…, status, terminalCode, origin, evidence[], comparison?, stats?}]}
DELETE /api/conversations/:id    cascades (§4)
POST /api/turns/:assistantMessageId/retry   (P1 feature)
GET /api/lab · POST /api/lab/start {date} · POST /api/lab/advance {days|toDate} · POST /api/lab/reset · POST /api/lab/sample
```

### 10.4 Clarification continuation (F19) [Later]

- A `clarify` event carries `{clarificationId, question, options[{index, label, logicalAt, preview}]}`. The server stores the options with their `episodeMessageId` in `clarifications`.
- The user's choice is a new turn with `selection:{clarificationId, optionIndex}`. The server validates that:
  - the clarification belongs to the same conversation and workspace;
  - it is not consumed;
  - the index exists;
  - the episode still exists and is eligible.
- If valid, the server marks the clarification consumed and runs `original_text` with `pinnedEpisodeId` set. Retrieval returns that episode directly, with no second natural-language search. Otherwise: `422 INVALID_SELECTION`.
- The user message is stored as "Selected: {label}".

### 10.5 SSE events

Every event carries `{turnId, seq}`, and is zod-validated on both server and client.

```
turn.started     {userMessageId, assistantMessageId, workspace, logicalNow, realNow, tz, route}
memory           {state, intervals[{label,startUtc,endUtc}], usedAlternate, episodes[{messageId,conversationId,logicalAt,preview,origin,eligible}], truncated}
clarify          {clarificationId, question, options[...]}                               (terminal)
search.started   {queryId, query, entity?, round}     search.finished {queryId, resultCount, ms, error?}
answer.delta     {text}                                                                  (chat_plain only)
answer.sentence  {text, refs[], support:'sourced'|'no_source'}
answer.withheld  {count}
comparison.item  {item, verdict, basis?, reasons[]}
sources          {sources[{ref,url,title,domain,domainMatch,retrievedAt,publishedAt,entity}]}
turn.completed   {assistantMessageId, headline?, coverage?, stats}                       (terminal)
turn.error       {code, message, partialSaved}                                           (terminal)
```

## 11. UI [P1 minimal; rest Later]

**Layout.**
- Left: a **Live / Timeline Lab** switch (Lab arrives later), and conversations grouped by logical day.
- Center: the chat.
- Lab adds a slim banner: simulated date, real date note, set start (empty Lab only), +1 day, +1 week, a date picker, "Load sample history", "Reset Lab" with confirmation.

**Adornments:**
- memory chip;
- source chips (domain, "fetched {real date}", "site name matches" when exact);
- a live progress line from real events only;
- the Then vs Now card (entity · attribute · then · now · verdict badge · basis · sources), with the code headline and coverage line;
- `no source` sentences labelled;
- the withheld-statements line;
- "Execution details" (P1).

**Controls and states:**
- Stop.
- Typed error banners.
- A no-key banner.
- A persistent **FAKE PROVIDERS** banner in fake mode.
- Origin badges: "Sample", and "Fake" (visible only if fake rows are ever shown).

**Accessibility:**
- Semantic landmarks.
- Enter sends, Shift+Enter adds a newline, Esc stops.
- Focus is managed after a turn.
- `aria-live="polite"` for progress.
- Colour is never the only signal.
- Usable down to 360 px.

## 12. No-key boot, fakes and provenance (C7, F20) [P1]

- **Missing keys never crash boot.**
  - `/api/health` → `missing_key`.
  - Composer: "Live AI isn't configured: add GEMINI_API_KEY (and TAVILY_API_KEY for web search). Stored history, Timeline Lab and date-based recall still work."
  - Model paths → `turn.error{NOT_CONFIGURED}`. Nothing is simulated.
- **Fake providers** run only when `NODE_ENV=test` or `CONTINUUM_FAKE_PROVIDERS=1`. In that mode:
  - **the database file is `continuum-fake.db`**, never `continuum.db`;
  - every row written is `origin='fake'`;
  - a persistent banner reads "FAKE PROVIDERS: responses are scripted test fixtures".
- A real-mode server that finds `origin='fake'` rows in `continuum.db` refuses to start and names them. Tests use a temp `DATA_DIR` per test file.
- **Sample history** has `origin='sample'`, is Lab-only, and is always badged.

## 13. Security and failure model

**Security:**
- Keys are server-only; `.env` is gitignored; values never appear in logs.
- Binds to 127.0.0.1; 32 KB body limit.
- Parameterised SQL only. FTS input: each term double-quoted, with operators stripped.
- Markdown is rendered without raw HTML. Links are `http(s)` only, with `rel="noopener noreferrer"`.
- Untrusted-block isolation (§7.1). No URL fetching from model output.

**Failures:**
- Terminal guarantees: §10.2. Startup recovery: §4.
- Partial research reports coverage ("Checked 4 of 5; search for Folk failed").
- If structured output for D fails after the attempt budget: the evidence collected is shown as a source list, and every requested row is `unverified`.
- Node outside `^22.13 || ^24`: startup prints the requirement and exits.

## 14. Latency targets [TARGET, measured in Phase 0 and the evaluation]

| Path | First progress | First answer text | Total (p50) | Total (p90) |
|---|---|---|---|---|
| Deterministic recall / clarify | < 150 ms | < 300 ms | < 0.5 s | < 1 s |
| `chat_plain` | < 150 ms | < 2 s | < 4 s | < 8 s |
| `undecided`, no search | < 150 ms | = step total (held) | < 5 s | < 9 s |
| Research (1 round) | < 150 ms | < 6 s | < 9 s | < 15 s |
| Reverify, 5 entities | < 150 ms | < 8 s (first item) | < 14 s | < 25 s |

Holding `undecided` text trades first-token latency for never showing an unsearched factual answer. The lexicon keeps clear chat on the direct-streaming path. If measured `undecided` latency is poor, the owner decides: widen `chat_plain`, or accept it.

## 15. Stack (verified with `npm view` on 2026-11-18; pin exact versions)

| Package | Version | Engines / peers (verified) |
|---|---|---|
| `ai` | 7.0.173 | node ≥ 22; zod `^3.25.76 \|\| ^4.1.8` |
| `@ai-sdk/google` | 4.0.121 | node ≥ 22 |
| `zod` | 4.x (pin exact at install) | — |
| `hono` | 4.13.19 | node ≥ 16.9 |
| `@hono/node-server` | 2.1.9 | node ≥ 20 |
| `react`, `react-dom` | 19.3.1 | — |
| `vite` | 8.3.8 | node `^20.19 \|\| ≥22.12` |
| `@vitejs/plugin-react` | 6.3.0 | vite `^8` |
| **`typescript`** | **5.9.3** | `typescript-eslint` 8.73.0 requires TS `>=4.8.4 <6.1.0`, so **TS 7.0.2 is excluded** |
| `typescript-eslint` / `eslint` | 8.73.0 / 10.15.0 | eslint node `^20.19 \|\| ^22.13 \|\| ≥24` |
| `tsx` | 4.23.15 | node ≥ 18 |
| `vitest` | 5.1.0 | node `^22.12 \|\| ^24 \|\| ≥26` |
| `@playwright/test` | 1.65.1 | node ≥ 20 |
| `concurrently` | 10.0.7 | node ≥ 22 |
| `chrono-node` | 2.10.3 | — |
| `react-markdown` | current at install | — |

- **Declared engines: `"node": "^22.13.0 || ^24.0.0"`.** 22.13 is the floor from eslint and from `node:sqlite` without a flag; vitest excludes Node 23 and 25.
- Node 24 is the primary runtime. Node 22 support is **claimed only after a run on Node 22** (a local nvm install or a GitHub Actions run approved by the owner). Until then, the README says "tested on Node 24".
- Prettier is optional; skip it unless it costs nothing.
- Test helpers: `MockLanguageModelV4` from `ai/test`; `simulateReadableStream` from `ai`.
- SQLite: `node:sqlite` with FTS5, porter, WAL, FKs and cascade-to-FTS verified on Node 24.11.0 / SQLite 3.50.4. Suppress only its ExperimentalWarning.

## 16. Corrections incorporated

C1–C7: as in v1.0 (§6, §7, §8, §5.2, §9, §12). F01–F20 and E01–E05: see `CORRECTIONS-v1.1.md`, which gives the exact section for each.
