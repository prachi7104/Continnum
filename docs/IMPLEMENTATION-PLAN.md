# Continuum: implementation plan

*Status: **FROZEN v1.1**, 2026-11-18 (v1.0 in `v1.0/`). Builder: Codex. Reviewer: Claude (targeted). Coordinator: ChatGPT. Owner and final decision-maker: Prachi.*

*Project directory: `C:\projects\continuum`. Reuse `C:\projects` if it exists. **Never overwrite or delete an existing `continuum` directory without the owner's explicit approval.** Git is local only; there is no remote until the owner says so.*

## Ground rules (every phase)

1. **Follow the frozen documents.** CONTINUUM-SPEC.md, ARCHITECTURE.md and EVALUATION.md (v1.1) are the source of truth. A deviation needs a written entry in `docs/DECISIONS.md`. Only deviations that change behaviour, spending or scope need the owner's approval. Implementation details inside the contract don't.
2. **Commits:**
   - One commit (or a small series) per task, with conventional messages.
   - Use the repo's existing git identity; never change it.
   - **No `Co-Authored-By` AI trailers, no "Generated with" lines, no AI attribution.**
   - Never push.
3. **Spending:**
   - No paid services and no billing changes.
   - Live calls only within EVALUATION §7 budgets. Phase 0 is enforced by the committed ledger (ARCHITECTURE §9.3).
   - `maxRetries: 0` on every SDK call.
4. **Exact versions:** ARCHITECTURE §15 (TypeScript 5.9.3, not 7). Commit `package-lock.json`. Verify AI SDK v7 APIs and the Tavily request schema against their current docs before use.
5. **Definition of done for every task:**
   - `npm run typecheck`, `npm run lint` and `npm test` pass.
   - The new behaviour has a test.
   - There are no TODO placeholders in shipped paths.
6. **Keep it explainable (R12).** Plain code, few dependencies, a header comment per module.
7. **Honest reporting.**
   - "CI green" means local `npm run ci`. A GitHub Actions run is reported only if it actually happened.
   - Environment facts come from Codex's own workspace.

## Authorisation summary

Once the owner says "start implementation":

| Work | Proceeds without further review? |
|---|---|
| Phase 0, all tasks (0.1–0.8), live calls within the ledger caps | **Yes** |
| Phase 1 offline tasks: 1.1–1.5, 1.7, 1.9, 1.10, 1.11 | **Yes** |
| Phase 1 provider-dependent tasks: 1.6 (Gemini wiring) and 1.8 (live chat check) | **Yes, once the qualification gate passes** (below). This is a measured criterion, not an owner checkpoint. |
| If no keys are available | Finish all offline work, then report `qualification: BLOCKED` and stop before 1.8's live check |
| Any change to scope, budgets, schema contracts or stack choices; any push, remote, deployment, paid usage; overwriting an existing directory | **Owner approval** |

**Qualification gate (automatic).** At least one candidate model passes **all** of the following:
- streaming;
- single-step tool call without `execute`;
- ≥ 2 parallel calls in one step;
- a final generation with tool history (either `toolChoice:'none'` or tools omitted);
- `Output.array`;
- cancellation.

Codex sets `CONTINUUM_MODELS` to the passing models, ordered by measured suitability and then latency, and records why in `docs/PROVIDER-QUALIFICATION.md`. If no model passes, stop and report.

## Schedule (owner targets, not official deadlines; re-based 2026-11-18)

| Date | Milestone |
|---|---|
| Wed 18 Nov | Phase 0; start Phase 1 |
| Thu 19 Nov | Phase 1 complete (first milestone) |
| Fri 20 Nov | Phases 2–3 |
| Sat 21 Nov | Phases 4–5 → **functional MVP** |
| Sun 22 Nov | Minimum live evaluation (EVALUATION §5.1), hardening |
| Mon 23 Nov | Phase 7 (submission prep) |

The v1.0 MVP target of 20 Nov **slips by one day**, because Phase 0 did not start on 17 Nov and v1.1 adds Phase 1 scope (turn table, recovery, disconnect test, provenance). The owner may cut P1 items to recover the day.

## Phase 0: qualification (≈ 3 h)

| ID | Task | Acceptance |
|---|---|---|
| 0.1 | Record the environment **from Codex's workspace**: OS, Node, npm and Git versions, free RAM, disk space; whether `C:\projects` and `C:\projects\continuum` exist | `docs/ENVIRONMENT.md`. If `continuum` exists → stop and ask |
| 0.2 | `scripts/check-sqlite.ts`: FTS5 + porter, WAL, `foreign_keys=ON` enforced, composite-FK workspace rejection, cascade-fires-FTS-trigger, `bm25()` sign (negative = better) | Exits 0 and prints each check |
| 0.3 | Verify the AI SDK v7 docs for: `streamText` single-step with `stopWhen: isStepCount(1)`; tools without `execute`; `response.messages`; tool-result message shape; `toolChoice`; `maxRetries`; `abortSignal`/`onAbort`; `Output.array` + `elementStream`; `MockLanguageModelV4`. Also the Google provider options. Verify the Tavily search request and response schema. | Notes with doc URLs in `docs/DECISIONS.md` |
| 0.4 | Scaffold what doctor needs: `package.json` (exact pins, engines `^22.13.0 \|\| ^24.0.0`), strict `tsconfig`, `.env.example`, `.gitignore`, provider interfaces, Gemini + Tavily adapters, `scripts/budget-ledger.ts`, `scripts/doctor.ts` | `npm install` is clean; `npm run doctor` runs with and without keys |
| 0.5 | `npm run doctor` (quick) | Table printed; ledger updated |
| 0.6 | `npm run doctor -- --full` | `docs/PROVIDER-QUALIFICATION.md` (measured table, gate result, `CONTINUUM_MODELS` order with reasons, the owner-read free-tier rate limits); ledger committed |
| 0.7 | Commit the frozen evaluation fixtures: `resolver-cases.json` (T01–T28), `corpus.json` (C01–C20), `retrieval-queries.json` (Q01–Q33, P01–P15), `live-scenarios.json` (L01–L24 + the §5.1 set); plus `scripts/check-corpus.ts` enforcing the EVALUATION §3.1 authoring constraints. All of this goes **before** any resolver or retrieval code. | Committed; hash in `docs/DECISIONS.md`; `check-corpus` exits 0 |
| 0.8 | Copy the handoff docs (the five files, `CORRECTIONS-v1.1.md`, `OFFICIAL-BRIEF-NOTES.md`) into `docs/` | Present |

**Phase 0 live budget (hard cap; one cumulative ledger across all doctor runs):**

| Provider | Cap | Planned use |
|---|---|---|
| Gemini (physical requests) | **24** | Quick: 1 plain generation × 3 models = 3. Full, per model: 1 streaming latency sample, 1 tool step with ≥ 2 parallel calls, 1 final with tool history + `toolChoice:'none'`, 1 final with tools omitted, 1 `Output.array`, 1 cancellation = 6 × 3 = 18. **Total 21, 3 spare.** |
| Tavily (credits) | **5** | Quick: 1 basic search. Full: 1 basic search to confirm the response schema (`published_date`, chunks). **Total 2, 3 spare.** Tool round trips use fake search results. |
| Groq | **0** | — |

Every request is ledgered before dispatch, failures included. `maxRetries: 0`. No deliberately invalid live requests; error shapes are tested with mocks. If a model fails early in the full run, its remaining tests are skipped, and the spare requests are not spent elsewhere without a note.

## Phase 1: first vertical slice (≈ 1.25 days)

Goal: a usable, persistent chat with real Gemini streaming and a correct turn lifecycle. **No search loop yet.**

| ID | Task | Depends | Acceptance |
|---|---|---|---|
| 1.1 | Repo structure (`client/`, `server/src/`, `shared/`, `scripts/`, `tests/{unit,integration}`, `e2e/`, `fixtures/`, `eval/`, `docs/`). Strict TS 5.9.3, ESLint 10 + typescript-eslint 8.73. `.nvmrc` = 24. | 0.4 | typecheck and lint pass |
| 1.2 | `npm run dev` with `concurrently`: Hono on 127.0.0.1:8787 (tsx watch) + Vite on 5173 with an `/api` proxy | 1.1 | Fresh clone: `npm install && npm run dev` opens the UI |
| 1.3 | DB: the **full** ARCHITECTURE §4 schema, created on boot (version table, WAL, `foreign_keys=ON` asserted, FTS triggers); startup recovery of active turns; real-mode refusal if fake rows are present; fake mode uses `continuum-fake.db`. `repo.ts` is the only `node:sqlite` importer. | 1.1 | Unit tests: auto-create; FK enforced; workspace-mismatch insert rejected; conversation delete leaves 0 orphans in every table + FTS integrity-check; recovery converts `active` → `INTERRUPTED` |
| 1.4 | `clock.ts`: `LogicalClock` (Live, Lab anchor model: start-on-empty, forward-only advance, reset with epoch++), `WallClock`, `Monotonic`. All three injected. | 1.3 | Unit tests: start only when empty; backward advance rejected; reset deletes only lab rows and bumps the epoch; `retrieved_at` and `recorded_at` use `WallClock`; deadlines use `Monotonic` |
| 1.5 | Conversation API + turn lifecycle (ARCHITECTURE §10.1–10.2): transactional admission, `turns` table, `UNIQUE(conversation_id, client_turn_id)`, `ux_one_active_turn`, SSE via Hono `streamSSE` + `onAbort` + request signal, one durable terminal state, ≤ 1 terminal event, lock release | 1.3, 1.4 | Integration tests via `app.request()`: 409 TURN_IN_PROGRESS; DUPLICATE_TURN creates no message and no provider call; cancel → `cancelled` with partial text; deadline → `DEADLINE`; provider failure → `error`. **Plus one real-HTTP test** (server on an ephemeral port, `fetch` aborted mid-stream): provider abort observed, row `cancelled`, lock released, the next turn is admitted. |
| 1.6 | `ModelProvider` + fallback chain (ARCHITECTURE §9.2), attempts counted before dispatch, `maxRetries: 0`, `attempts` rows; Gemini adapter; fake provider (gated, `origin='fake'`) | 0.6 gate, 1.5 | Mock tests: 429 → next model; 404 → next; 401 → `CONFIG_ERROR`, no fallback; 400 → no fallback; attempt cap enforced; no SDK retries |
| 1.7 | `SearchProvider` + Tavily adapter (explicit `search_depth:'basic'`, no `auto_parameters`) + fake; **not** given to the model yet | 0.4 | Mocked-`fetch` tests: request body, mapping, 429 Retry-After, 432 → `SEARCH_UNAVAILABLE` |
| 1.8 | Route classifier (ARCHITECTURE §6.2) + `chat_plain` path: system prompt with logical date, weekday and tz; ≤ 8 recent turns; `answer.delta`; stats with monotonic timings. `research`/`undecided` turns get the code-written "web research isn't built into this version yet" prefix. | 1.6 | Classifier unit tests (lexicon cases); a real Gemini answer streams in the UI (≤ 10 live requests); stats stored with `route` |
| 1.9 | Minimal React UI: Live sidebar, conversation view, composer (Enter sends, Shift+Enter newline, Esc stops), Stop, typed error banner, no-key banner, FAKE banner, timestamps, status badges for cancelled/partial/interrupted | 1.5 | Keyboard-only use works; no console errors; 360 px layout |
| 1.10 | Keyless boot: health `missing_key`; model turns → `NOT_CONFIGURED`; UI explains | 1.8, 1.9 | Integration test with an empty env |
| 1.11 | Tests and CI: Vitest unit + integration; one Playwright smoke test (fake mode, `workers:1`, Chromium); `.github/workflows/ci.yml` (Node 22.x + 24.x matrix) written but not pushed; `npm run ci` runs the same steps locally | 1.9 | `npm run ci` passes locally. The report says "local", and names Node 22 as unverified unless it was actually run. |

**Phase 1 exit (first milestone):** the acceptance criteria in CODEX-PHASE-0-1-PROMPT.md.

## Phase 2: research loop with release gate (≈ 0.75 day)

| ID | Task | Acceptance |
|---|---|---|
| 2.1 | Single-owner loop (ARCHITECTURE §6.1, §6.4): one `streamText` per generation, tools without `execute`, tool-result message for every `toolCallId`, budgets, final generation, `UNRESOLVED_TOOL_CALL` | Mock tests: every budget edge; a skipped call still gets a result; the tool is never executed by the SDK; no pending tool call at the end |
| 2.2 | Routing classes live: `research` (required tool), `undecided` (held text), `chat_plain` (direct); remove the Phase 1 prefix | Tests: held text discarded when a tool is called; a current-info cue never yields a model-only answer |
| 2.3 | Executor: normalise, dedupe, `allSettled`, concurrency 6, real progress events, `entity` per call | Tests: dedupe, partial failure reported |
| 2.4 | Evidence: sentence refs, `domain_match` (exact label only), per-entity selection and coverage table, top-up queries, untrusted blocks with escaping | Unit tests incl. an injection fixture and a 5-entity starvation case |
| 2.5 | Release gate (ARCHITECTURE §7.1): checkable-unsupported → withheld + a code line; `no_source` labelling | Unit tests; nothing released is retracted |
| 2.6 | UI: progress line, source chips, `no source` label, withheld line | Playwright (fake) |

## Phase 3: temporal resolver and memory (≈ 0.75 day)

| ID | Task | Acceptance |
|---|---|---|
| 3.1 | `temporal/resolve.ts` → UTC half-open intervals (ARCHITECTURE §5.1) | All T01–T28 pass |
| 3.2 | `retrieve.ts`: eligibility boundaries in SQL, `rel = −bm25`, the confidence and tie rules, the seven states, last discussion (§5.4), baseline eligibility (§5.5) | Q01–Q33 and P01–P15 run; metrics in `eval/results/`; the P2 gate is evaluated |
| 3.3 | Deterministic recall rendering; EMPTY_RANGE / NO_CONFIDENT_MATCH lines; `clarify` + `clarifications` table + selection continuation (§10.4) | Integration: 0 provider calls; selection with a wrong conversation → 422 |
| 3.4 | Recall synthesis (1 gen, H-cites, gate) | Mock tests |
| 3.5 | UI: memory chip, clarify buttons | Playwright (fake) |

## Phase 4: Timeline Lab and keyless reviewer path (≈ 0.5 day)

| ID | Task | Acceptance |
|---|---|---|
| 4.1 | Lab API (start, advance, reset, sample) with the mutex, `409 LAB_BUSY` and the epoch guard; workspace switch; banner | Tests: a mutation during an active lab turn → 409; a stale completion after reset writes nothing. Playwright: start, ask, advance a week, "what did I ask last Tuesday?" with no keys |
| 4.2 | `fixtures/lab-sample.json` (≥ 6 conversations over 3 weeks, `origin='sample'`) | Badge everywhere; reset removes it |
| 4.3 | README "Reviewer quickstart" | Owner follows it on a fresh clone |

## Phase 5: reverification and Then vs Now (≈ 1 day) → MVP

| ID | Task | Acceptance |
|---|---|---|
| 5.1 | Baseline extraction: eligible H sentences, checkable detection, the requested-row denominator | Unit tests |
| 5.2 | D gen 1 `toolChoice:'required'` (entity + attribute queries); final `Output.array(ComparisonItem)` via `elementStream` | Mock tests: 2 generations |
| 5.3 | `validate/values.ts` + `compare.ts` (ARCHITECTURE §8.2–8.6): derived numbers, essential qualifiers, side-specific presence, dedupe, multi-observation rule, coverage rows, basis, real-time intervals | Table-driven tests for all six verdicts + `qualifier_unknown` + `numeric_claim_mismatch` + a dropped item counted + `claim_only` wording + the Lab "fetched minutes apart" wording + no interval from `logical_at` |
| 5.4 | Missing memory with an explicit target → research + "no earlier record" | Integration (empty DB) |
| 5.5 | Then vs Now card + headline + coverage + basis labels | Playwright (fake) |
| 5.6 | Live MVP smoke L06–L08 (budget: EVALUATION §7) | Owner sign-off → **MVP** |

## Phase 6: evaluation, hardening, P1 (≈ 1 day)

- **Required:** the minimum live evaluation, EVALUATION §5.1, with B0.
- **If time and budget allow:** the full live evaluation (§5.2, owner approval for credits); the Tier 2 Playwright suite; retry; execution details; the bounded recommendations scan; the memory drawer; an accessibility pass.
- **Acceptance:** `eval/results/*.md` generated from raw transcripts; every DESIGN.md number traces to a results file.

## Phase 7: documentation and submission (≈ 0.5 day)

| Owner tasks | Codex tasks |
|---|---|
| DESIGN.md (≤ 1 page; Codex and Claude review it for accuracy) | README polish |
| Recording the 1-minute video | Fresh-clone verification on Windows |
| Making the repo public, and the first GitHub Actions run | |
| Filling in the form (project answers from the career profile) | |

## Critical path

```
0 ─► 1 ─► 2 ─► 5 ─► 6 ─► 7
      └─► 3 ─► 4 ─┘         (3.1 resolver is pure: it can start right after 0.7)
```

## Risks

| Risk | Mitigation |
|---|---|
| Free-tier availability or latency differs per key | Measured gate; the chain and budgets handle failures at runtime |
| Gemini rejects tool history without declared tools | Phase 0 tests both final-generation variants |
| `undecided` held-text latency feels slow | Measured; the owner decides to widen `chat_plain` or accept it |
| Lexical retrieval misses paraphrases | P2 gate with measured numbers; embeddings only on evidence |
| Node 22 untested locally | Claim Node 24 only until an actual Node 22 run |
| Tavily credits | Staged budgets (EVALUATION §7); fake search in Tiers 1–2 |
| Schedule slip | Re-based schedule; P1 items are the first cut |
