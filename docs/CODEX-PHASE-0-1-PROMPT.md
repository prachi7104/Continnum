# Codex task: Continuum Phase 0 (qualification) and Phase 1 (first vertical slice)

*Handoff v1.1, 2026-11-18. Supersedes v1.0 (kept in `v1.0/`).*

You are the implementation engineer for **Continuum**, a time-aware research chat agent. It is the owner's submission to the minimi Software Engineering Intern challenge.

The owner (Prachi) is the final decision-maker. The design is **frozen at v1.1**. Do not redesign it.
- If something in the documents is wrong or impossible, write it up in `docs/DECISIONS.md`.
- Implementation details inside the contract: decide yourself and record them.
- Changes to behaviour, scope, budgets, schema contracts or the stack: stop and ask the owner.

## Inputs

Read all of these before writing code. They sit next to this prompt in the handoff folder.
- `CONTINUUM-SPEC.md`: product, official requirements R1–R18, scope
- `ARCHITECTURE.md`: the design. Sections tagged **[P0–1]** are yours now; **[Later]** sections are contracts you must not violate in the schema or interfaces
- `IMPLEMENTATION-PLAN.md`: tasks 0.1–1.11, the authorisation table, the qualification gate, the Phase 0 request plan
- `EVALUATION.md`: frozen fixtures (T01–T28, C01–C20, Q01–Q33, P01–P15, L01–L24) and live budgets
- `CORRECTIONS-v1.1.md`: what changed from v1.0, and why
- `OFFICIAL-BRIEF-NOTES.md`: how the challenge requirements were verified
- this prompt

## Hard constraints

1. **Location: `C:\projects\continuum`.**
   - If `C:\projects` exists, reuse it.
   - **If `C:\projects\continuum` already exists, stop and ask.** Never overwrite or delete it.
2. **Machine:** Windows, 8 GB RAM class, often ~1 GB free. Run one heavy process at a time. Playwright uses `workers: 1`, Chromium only.
3. **Runtime:** TypeScript **5.9.3**, strict. TS 7 is excluded: `typescript-eslint` 8.73.0 requires TS `<6.1.0`.
   - engines `"node": "^22.13.0 || ^24.0.0"`; Node 24 is primary.
   - It must run with `npm install` then `npm run dev`.
   - Every env var goes in `.env.example`.
4. **Exactly one model-callable tool:** `web_search`, declared **without `execute`**. Your engine is the only orchestrator: one `streamText` call per generation, `stopWhen: isStepCount(1)`, `maxRetries: 0`. Don't use `prepareStep` or SDK multi-step loops (ARCHITECTURE §6.1).
5. **Git:**
   - `git init` locally, using the repo's configured identity. Don't change it.
   - **Never add `Co-Authored-By` trailers, "Generated with …" lines, or any AI attribution** in commits, code or docs.
   - **Never push, add remotes, create GitHub repos or trigger Actions.**
6. **Spending:**
   - No paid services and no billing changes.
   - Live calls only:
     - in Phase 0, through the ledger;
     - up to 10 Gemini chat requests to verify task 1.8.
   - No Tavily calls in Phase 1.
   - **No deliberately invalid live requests:** error paths are tested with mocks.
   - Never log key values.
7. **Dependencies:** pin exact versions from ARCHITECTURE §15 and commit `package-lock.json`. Verify current APIs before use:
   - AI SDK v7: https://ai-sdk.dev/docs;
   - Tavily: https://docs.tavily.com.
   - Avoid extra dependencies.
8. **SQLite:** built-in `node:sqlite` only. `server/src/db/repo.ts` is the only importer.
   - `PRAGMA foreign_keys=ON` on every connection, asserted at boot.
   - Suppress only its ExperimentalWarning.
9. **Time:**
   - Only `server/src/clock.ts` reads system time. It provides `LogicalClock`, `WallClock` and `Monotonic`.
   - Deadlines and latency use `Monotonic`. Simulated time never touches them.
   - All persisted timestamps are UTC ISO `YYYY-MM-DDTHH:mm:ss.sssZ`.
10. **Honesty in the product:**
    - No simulated AI or search output outside fake mode.
    - Fake mode uses `continuum-fake.db`, writes `origin='fake'`, and shows a persistent banner.
    - No fake progress events.
    - Missing keys → `NOT_CONFIGURED`.
    - Current-information questions in Phase 1 get the code-written "web research isn't built into this version yet" prefix (ARCHITECTURE §6.2).
11. **Plain, explainable code:**
    - No agent frameworks, no DI containers, no metaprogramming.
    - A header comment per module.
    - The owner must be able to explain every file.

## Phase 0: qualification

Do tasks 0.1–0.8 (IMPLEMENTATION-PLAN). Key points:

- **0.1:** record environment facts **from your own workspace** in `docs/ENVIRONMENT.md`. Don't copy the figures in the spec.
- **0.2:** `scripts/check-sqlite.ts` verifies:
  - FTS5 + porter;
  - WAL;
  - FK enforcement;
  - composite-FK workspace rejection;
  - cascade → FTS trigger;
  - `bm25()` sign (negative is better).
- **Budget ledger:**
  - `scripts/budget-ledger.ts` with `docs/qualification-ledger.json`, which is committed.
  - Caps: **Gemini 24 physical requests, Tavily 5 credits, Groq 0**, shared across quick and full doctor runs.
  - Record each request **before** dispatch; refuse at the cap. The code never resets the ledger.
- **Doctor:** `npm run doctor` (quick) and `npm run doctor -- --full`, following the exact request plan in IMPLEMENTATION-PLAN §Phase 0 (21 Gemini + 2 Tavily planned).
  - Qualify each candidate model for:
    - streaming;
    - a single-step tool call with no `execute`;
    - ≥ 2 parallel calls in one step;
    - a final generation with tool history and `toolChoice:'none'`;
    - a final generation with tools omitted;
    - `Output.array`;
    - cancellation mid-stream;
    - first-chunk and total latency (monotonic).
  - Tool results in qualification come from the **fake** search.
  - Candidates: `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.5-flash-lite`.
  - Write `docs/PROVIDER-QUALIFICATION.md`:
    - the measured table;
    - the gate result;
    - the `CONTINUUM_MODELS` order with reasons (suitability first, then latency; not newest-first);
    - which final-generation variant each model accepts;
    - the free-tier rate limits the owner reads from AI Studio;
    - a statement that doctor cannot detect billing and that the key should come from an AI Studio project without billing.
- **No keys:** complete everything offline, write `qualification: BLOCKED (missing …)`, and continue with the offline Phase 1 tasks.
- **0.7 fixtures:** create and commit them, exactly as in EVALUATION.md, **before any resolver or retrieval code**:
  - `eval/fixtures/resolver-cases.json`
  - `corpus.json`
  - `retrieval-queries.json`
  - `live-scenarios.json`
  - `scripts/check-corpus.ts` (authoring constraints)

  Record the commit hash in `docs/DECISIONS.md`.
- **`.env.example`:**

```
# Required for live AI (free key from Google AI Studio; use a project WITHOUT billing enabled)
GEMINI_API_KEY=
# Required for web search (free Tavily plan: 1,000 credits/month)
TAVILY_API_KEY=
# Model order, set from docs/PROVIDER-QUALIFICATION.md
CONTINUUM_MODELS=
HOST=127.0.0.1
PORT=8787
DATA_DIR=./data
TURN_DEADLINE_MS=30000
TIMELINE_LAB=1
# Test-only scripted providers; uses continuum-fake.db and shows a FAKE PROVIDERS banner
CONTINUUM_FAKE_PROVIDERS=0
```

**Qualification gate (no owner checkpoint).** If at least one model passes every check, set `CONTINUUM_MODELS` and continue to 1.6 and 1.8. If none passes, stop and report. Report the Phase 0 results in your end-of-run report; don't pause for approval.

## Phase 1: first vertical slice

Do tasks 1.1–1.11 (IMPLEMENTATION-PLAN). Essentials:

- **Schema:** the full ARCHITECTURE §4, including `turns`, `clarifications`, `origin`, `lab_state.epoch`, the composite FKs, and `ix_msg_ws_logical`. Add startup recovery of `active` turns → `INTERRUPTED`.
- **Turn lifecycle (§10.1–10.2):**
  - transactional admission;
  - `UNIQUE(conversation_id, client_turn_id)` — a duplicate gets `409 DUPLICATE_TURN`, with no new message and no provider call;
  - `ux_one_active_turn`;
  - Hono `streamSSE` + `stream.onAbort()` + `c.req.raw.signal`;
  - exactly one durable terminal state;
  - ≤ 1 terminal event;
  - distinct `CANCELLED` / `DEADLINE` / provider-error codes;
  - lock release.
- **Providers (§9):**
  - a fallback chain only on 404, 429, 5xx, network error, or no first byte within 8 s — never on 400, 401, 403 or a safety block;
  - attempts ≤ generations + 2, counted before dispatch and written to `attempts`;
  - Tavily adapter with explicit `search_depth:'basic'` and no `auto_parameters`;
  - search is not given to the model yet.
- **Chat:**
  - the route classifier (§6.2);
  - `chat_plain` streaming with `answer.delta`;
  - a system prompt with the logical date, weekday and tz;
  - ≤ 8 recent turns;
  - stats `{generations, attempts, modelUsed, route, tFirstProgressMs, tFirstAnswerTextMs, tTotalMs}`.
- **UI (§11, minimal but polished):**
  - Live sidebar, chat view, composer (Enter sends, Shift+Enter newline, Esc stops);
  - Stop, typed error banner, no-key banner, FAKE banner, timestamps;
  - cancelled/partial/interrupted badges;
  - semantic HTML, visible focus states, `aria-live`, works at 360 px.
- **Tests:**
  - Unit: clocks, repo (FK, cascade, orphan check, FTS integrity-check, recovery), fallback rules with `MockLanguageModelV4`, Tavily with mocked `fetch`, event schemas, classifier.
  - Integration via `app.request()`: success, 409s, duplicate, cancel, deadline, provider error, keyless.
  - **One real-HTTP disconnect test** on an ephemeral port.
  - **One Playwright smoke test** (fake mode, temp `DATA_DIR`): send → streamed text + FAKE banner → reload → the conversation persists.
- **CI:** write `.github/workflows/ci.yml` (Node 22.x + 24.x) but don't push it. `npm run ci` runs the same steps locally. Report it as **local** and list Node 22 as unverified unless you ran it.

## Acceptance criteria: first milestone (all must be true)

1. On a fresh local clone, `npm install && npm run dev` starts both processes with no errors, and the UI opens.
2. **No keys:** the app boots, `/api/health` shows `missing_key`, the UI explains, and a message gets `NOT_CONFIGURED`. Nothing is simulated.
3. **With a qualified Gemini key:** a chat message streams a real answer. The stored stats show the model used, generations = 1, the route, and three monotonic timings. A current-info question shows the code-written prefix.
4. **Stop mid-stream:** the message is `cancelled` with its partial text, and the next message is admitted. The real-HTTP disconnect test proves the same for a dropped connection.
5. **Persistence:** a restart keeps all data; a turn killed mid-stream comes back as `INTERRUPTED`; deleting `data/` recreates an empty DB.
6. **Idempotency:** repeating a `clientTurnId` creates no duplicate message and no provider call.
7. **Integrity:** FKs are enforced; deleting a conversation leaves zero orphans and a clean FTS integrity-check.
8. **Doctor:** quick and `--full` both run. `docs/PROVIDER-QUALIFICATION.md` holds measured results and the gate outcome. The ledger shows ≤ 24 Gemini requests and ≤ 5 Tavily credits.
9. `npm run ci` passes locally: typecheck, lint, unit, integration, the disconnect test, and the Playwright smoke test.
10. The fixtures were committed before any resolver or retrieval code, with the hash recorded, and `check-corpus` passes.
11. Exact versions, `package-lock.json` committed, and **no AI attribution anywhere in `git log`**.
12. `docs/ENVIRONMENT.md`, `docs/DECISIONS.md`, `docs/PROVIDER-QUALIFICATION.md` and `docs/qualification-ledger.json` exist and are accurate.

## First action

Run these read-only commands in your workspace:

```
node --version
npm --version
git --version
git config user.name
git config user.email
```

Then check free memory and disk space, whether `C:\projects` exists, and **whether `C:\projects\continuum` exists** (if it does: stop and ask). Record the results for `docs/ENVIRONMENT.md`. Then create the directory, `git init`, copy the handoff docs into `docs/`, and start task 0.2.

## Reporting (at the end, or when blocked)

- What was done, with commit hashes.
- Test results: paste the summary lines.
- The ledger totals, plus any Phase 1 live requests.
- The qualification gate result and `CONTINUUM_MODELS`.
- Anything not done or not verified (Node 22, the GitHub Actions run, rate limits).
- `docs/DECISIONS.md` entries that need the owner.

Don't claim something works unless you ran it.
