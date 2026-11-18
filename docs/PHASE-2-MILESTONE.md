# Continuum Phase 2 milestone

18 November 2026 · `E:\projects\Continuum` · `main`

| Item | Status |
|---|---|
| Phase 0 qualification and Phase 1 functionality | **ACCEPTED** by the owner. Previously established live evidence remains in [PHASE-0-1-MILESTONE.md](PHASE-0-1-MILESTONE.md). |
| Phase 1 Git closeout | **COMPLETE** at `f600734ea256603896b0f26bf1e3d769d150e7da`. |
| Phase 2 offline milestone | **PASS** for the 43 verified component tests and the native Chromium result recorded before the corrected implementation commit. The full native stock terminal transcript was not retained in the workspace. |
| Phase 2 Git commit | **COMPLETE** at `de559ca4ef0b27ea018e0fbc4cb37d4aa5cf8602`. The worktree was clean at retest dispatch and on inspection before Phase 3 work. |
| Phase 2 live research | **FAILED**. The original run stopped at an evidence limitation. The retest reached the first-byte deadline before search. Successful grounded live research remains open. |
| Hosted CI and Node 22 | **NOT RUN**. Local verification uses Node 24.11.0 and npm 11.6.1. |

## Baseline and integrity

| Commit | Scope |
|---|---|
| `f600734ea256603896b0f26bf1e3d769d150e7da` | Phase 1 closeout and reliable Windows browser teardown |
| `6068f5fb93bbb36320d02c05506dcb896c457965` | Qualified Gemini streaming |
| `e3c81338cd7a789e29528cac55ae88f0ea6252a8` | Provider qualification evidence |
| `7f2313f482dec3cb222f3246549bdf26b0cd8922` | Locked offline baseline |
| `00a4d3d32d7b5e674e046a382a146ba7ab7cb23f` | Frozen evaluation fixtures |

Phase 1 was already committed and clean at inspection. The closeout retains its direct-child Vite and Hono setup. The pinned Phase 1 checks reached Chromium, where an initial response wait timed out. A sequential Chromium rerun passed in 25.0 seconds. Earlier managed DNS and loopback failures are historical observations. Native installation and later pinned loopback tests succeeded. The historical evidence remains in the Phase 1 report.

The frozen fixture and corpus checker diff from `00a4d3d` is empty. All five SHA-256 hashes of the Phase 1 HEAD blobs independently matched [DECISIONS.md](DECISIONS.md). Git ignore and tracking checks covered credential files, SQLite and WAL files, test databases, logs, browser state, test output and provider transcripts. `.env.example` is tracked. The persistent qualification ledger has no diff from Phase 1 HEAD. No remote push occurred.

| Closed stage | Gemini attempts | Tavily credits | Groq calls |
|---|---:|---:|---:|
| Phase 0 | 20 of 24 | 2 of 5 | 0 |
| Phase 1 verification | 2 of 10 | 0 | 0 |

Unused allocations remain closed. The qualified model order is `gemini-3.5-flash-lite` followed by `gemini-3.6-flash`. `gemini-3.8-flash` remains excluded after the structured-output qualification timeout.

## Changed modules

| Area | Files |
|---|---|
| Orchestration and routing | `server/src/engine/{turn,budget,route}.ts` |
| Provider contracts and startup | `server/src/llm/{provider,gemini,fake,prompts}.ts`, `server/src/search/{executor,fake}.ts`, `server/src/index.ts`, `server/src/api/routes.ts` |
| Grounding, release and persistence | `server/src/evidence/{sources,release}.ts`, `server/src/db/repo.ts`, `shared/events.ts` |
| User interface | `client/src/App.tsx`, `client/src/style.css` |
| Automated checks | `tests/integration/{phase2-smoke,research,turns}.test.ts`, `tests/unit/{evidence,gemini-sdk}.test.ts`, `e2e/chat.spec.ts` |
| Bounded live verification | `scripts/phase2-smoke.ts` |
| Dependency and accounting | `package.json`, `package-lock.json`, `eval/budget.md`, `docs/PHASE-0-1-MILESTONE.md`, `docs/PHASE-2-MILESTONE.md` |

All existing exact dependency pins are retained. All 22 direct installed versions match the manifest and v3 lockfile. `tldts@7.5.4` is pinned for registrable-domain parsing, including private suffixes. The existing Tavily adapter already sends the approved Basic parameters. The [Tavily Search API reference](https://docs.tavily.com/documentation/api-reference/endpoint/search) documents the Basic chunk option and credit cost. Search snippets and metadata are retained with provenance and retrieval time. Publication time is present only when the provider supplies a parseable date.

## Research contract

- The turn engine owns the loop and the only model-callable tool is `web_search`. The Google adapter registers it without `execute`, uses one SDK step per generation, and disables SDK retries. Assistant tool messages are preserved and each admitted, skipped, or failed search call gets a matching result before the next generation. Duplicate call IDs and unsupported tool names end in `UNRESOLVED_TOOL_CALL`.
- Current-information turns require search on the first generation. Undecided turns hold draft text and discard it when tools are called. Ordinary conversation uses the existing direct text stream without search. Research fallback may replace a held draft before answer release. Ordinary chat preserves a partial answer on provider failure.
- The turn budget admits at most three logical generations, two search rounds, six queries per round, ten normalized unique queries and ten physical search credits, including retries. The Gemini attempt limit is generations plus two. The shared deadline is 30 seconds, first byte is limited to eight seconds, and a search gets up to seven seconds within the remaining deadline. A 429 can retry once when the provider supplies a `Retry-After` within three seconds and budget remains. A 432 is a typed search failure.
- Final generation explicitly disables tools with native tool history attached. The one permitted omitted-tools attempt following a stray final call is limited to Flash Lite, whose qualification covered that variant. If the engine cannot resolve the call it sends `UNRESOLVED_TOOL_CALL` and retains collected sources.
- Progress reflects admitted work. Evidence selection gives requested entities with hits a source before filling extra slots. The source ceiling is 8–12, with two or three bounded sentences per source. An exact registrable-label match is shown as “site name matches.” Source snippets are escaped in an untrusted prompt block and displayed as text. URL normalization preserves query strings and rejects unsafe schemes and embedded credentials.
- The gate strips invalid references, withholds checkable sentences with insufficient supporting evidence, labels uncited plain sentences “no source,” and persists released citations. A value must appear in cited evidence with corresponding wording. Total search failure produces `SEARCH_UNAVAILABLE` and a code-written limitation. Stop and disconnect use the shared cancellation path. The UI shows search progress, cited sources, expandable evidence and the actual retrieval date across reloads.

## Verification

| Check | Result |
|---|---|
| TypeScript and ESLint | **PASS** on the pinned installations. |
| SQLite and frozen corpus | **PASS**. WAL, foreign keys, composite workspace constraints, FTS5 stemming, BM25 ordering, cascade and FTS integrity, fixture IDs and corpus constraints. |
| Vitest | **PASS**. Post-investigation non-browser run passed 39 tests across seven files in 8.17 seconds, one worker at a time with provider keys masked. It includes real HTTP SSE, the new insufficient-evidence regression, the mocked 2/1 success path, duplicate launch rejection and 429 termination without retry. TypeScript, ESLint, SQLite and frozen corpus checks also passed after the change. |
| Real HTTP | **PASS**. The actual Hono Node adapter served loopback SSE for research. Tests asserted real search progress, gating, citation persistence and evidence on reload. The existing real HTTP disconnect test asserted provider abort, durable terminal state, lock release and a successful next turn. A separate research cancellation test asserted search abort and lock release. |
| Budget and failure handling | **PASS**. Deterministic checks covered one and two rounds, duplicate queries and call IDs, skipped results, six concurrent dispatches, ten total search credits, 429 retry consumption, timeouts, partial and total failures, fallback before release, and qualified final-tool disabling. |
| Chromium and full local `ci` command | **PASS** in the owner's native run with 38 Vitest and 2 Chromium tests, including teardown. The local browser result file reports passed. Earlier managed execution was blocked by automatic review for a Visual Studio telemetry connection. The forensics change only affects the smoke runner and its integration test. |
| Hosted CI and Node 22 | **NOT RUN**. |

The current committed history on `main` contains 78 unique blobs. A preflight scan found no sensitive artifact paths or matches for configured provider keys or recognizable Gemini, Tavily or Groq key formats. A publication scan must cover the eventual Phase 2 and Phase 3 commits as well.

### Native closeout commands

Run from native PowerShell. Stock CI includes both Chromium scenarios with one worker, fake providers, and an isolated database. The final port check verifies teardown. Continue to staging only after stock CI and teardown pass.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
$env:DO_NOT_TRACK = '1'
$env:NPM_CONFIG_OFFLINE = 'true'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD 'node_modules/.cache/continuum-playwright'
npm.cmd run ci
if ($LASTEXITCODE -ne 0) { throw 'Stock CI failed.' }
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5173,18787 -ErrorAction SilentlyContinue)
if ($listeners.Count -ne 0) { throw 'A browser test server is still listening.' }
```

Verify the staged path list before committing. Keep stock CI output for reporting.

```powershell
git add -- client/src/App.tsx client/src/style.css e2e/chat.spec.ts package.json package-lock.json scripts/phase2-smoke.ts server/src/api/routes.ts server/src/db/repo.ts server/src/engine/budget.ts server/src/engine/route.ts server/src/engine/turn.ts server/src/evidence/release.ts server/src/evidence/sources.ts server/src/index.ts server/src/llm/fake.ts server/src/llm/gemini.ts server/src/llm/prompts.ts server/src/llm/provider.ts server/src/search/executor.ts server/src/search/fake.ts shared/events.ts tests/integration/phase2-smoke.test.ts tests/integration/research.test.ts tests/integration/turns.test.ts tests/unit/evidence.test.ts tests/unit/gemini-sdk.test.ts eval/budget.md docs/PHASE-0-1-MILESTONE.md docs/PHASE-2-MILESTONE.md
if ($LASTEXITCODE -ne 0) { throw 'Staging failed.' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged whitespace check failed.' }
git diff --cached --name-only
```

```powershell
git commit -m 'feat: add bounded evidence-grounded web research'
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 commit failed.' }
git log -2 --format='%H %s'
git status --short --branch
```

## Limitations and owner decision

The release gate applies structural checks, including value and wording matching. It can withhold well-supported paraphrases and it does not establish semantic entailment. Entity coverage tracks the entities identified by tool calls. Source authority is limited to exact label matching. The Phase 2 work adds no memory retrieval, temporal resolver or comparison workflow.

## Original one-shot live smoke

The user asked “What is the latest released Node.js 24.x version according to the official Node.js website?” Flash Lite chose `Node.js latest 24.x version nodejs.org` for the entity `Node.js releases Node 24`. The guarded transport admitted the final Gemini request only after matching the original function call and a subsequent `web_search` result with tool mode `NONE`. The journal records the accepted stages. It does not retain the serialized payload or provider headers.

| SSE sequence | Event | Recorded payload |
|---:|---|---|
| 1 | `turn.started` | `research`, live workspace, Asia/Kolkata |
| 2 | `search.started` | Round 1, model-selected query above |
| 3 | `search.finished` | Same query ID, five results, 2,607 ms |
| 4 | `sources` | Five evidence sources E1–E5 |
| 5 | `answer.withheld` | One statement withheld |
| 6 | `turn.completed` | Two generations, two model attempts, one search credit, one round, evidence found, unsupported output |

All five evidence sources were retrieved at 08:44:55.735 UTC on 18 November 2026. These are the bounded passages supplied to synthesis and persisted, with their original evidence IDs. The original receipt holds their full wording and URLs.

| Source | Provider publication date (UTC) | Retained passages and relevance |
|---|---|---|
| E1 · Node.js 24.0.0 (Current) | 2025-05-06 | E1.1 announces Node.js 24. E1.2 describes V8 13.6 and npm 11. E1.3 describes removal of MSVC support and the ClangCL requirement. |
| E2 · Node.js releases index | 2026-11-11 | E2.1 is a release table header, E2.2 is a separator, E2.3 is a v27 Alpha row. |
| E3 · Node.js 24.11.0 (LTS) | 2025-10-28 | E3.1 is navigation, E3.2 is the Node.js 24.11.0 LTS heading, and E3.3 is a fragment, “RL.” The heading establishes that this version was released. |
| E4 · Node.js v24 download archive | 2026-09-07 | E4.1 says “# v13.6.233.17”. E4.2 points to a changelog or blog post. E4.3 points to the release schedule and LTS status. |
| E5 · NodeSource commentary on Node.js 24 | 2025-05-06 | E5.1 says “Node.js”. E5.2 and E5.3 thank contributors. |

E1–E4 are official `nodejs.org` sources. E5 is third-party. The retained passages do not establish the latest 24.x release. The original run did not capture Tavily's full result bodies or scores, passages discarded by the three-sentence cap, the pre-validation Gemini draft or its proposed citations. We cannot determine the model's proposed version, whether it provided a valid citation, or whether Tavily returned useful text that selection discarded. The investigation did not fetch external sources.

The only released and persisted assistant text was “I left out 1 statements I couldn't support with the sources I found.” No `answer.sentence` or `answer.delta` was emitted. The reload response parsed successfully and contained the original question, the exact assistant limitation, and all five evidence records. The assistant message status is `complete`, the turn is `done`, and both have terminal code `COMPLETED`. The SQLite database independently contains the same text and sources and zero citation rows. Its integrity check returned `ok`. The reload API carries citation markers in message text and evidence separately. The smoke reads normalized citation rows directly from SQLite.

| Provider stage | Dispatch UTC | HTTP response UTC | HTTP | Durations |
|---|---|---|---:|---|
| Gemini tool selection | 08:44:51.730 | 08:44:53.045 | 200 | 1,315 ms dispatch to response, 1,365 ms recorded attempt |
| Tavily Basic search | 08:44:53.138 | 08:44:55.723 | 200 | 2,585 ms dispatch to response, 2,603 ms recorded attempt |
| Gemini final tools disabled | 08:44:55.748 | 08:45:02.930 | 200 | 7,182 ms dispatch to response, 7,207 ms recorded attempt |

Monotonic turn measurements were 0 ms to first progress, 11,265 ms to first recorded answer text (the withholding notice), and 11,267 ms total. The database recorded start at 08:44:51.685 UTC and end at 08:45:02.963 UTC. Frame arrival times and reload latency were not captured.

### Failed assertions and offline correction

| Assertion | Root cause evidenced by the original run |
|---|---|
| `orderedProgress` | The two progress events were present and correctly ordered. The test predicate also required a sourced `answer.sentence` after `search.finished`. The gate released only `answer.withheld`, so the predicate mislabeled an evidence outcome as a progress defect. The SSE contract permits this sequence. |
| `officialVersionAfterReload` | The check starts from released sourced sentences. That list was empty, and the persisted and reloaded text correctly contained only the limitation. The bounded evidence failed to establish the requested latest version. The missing draft and discarded passages prevent distinguishing a model citation error from a false negative in the release gate or a useful passage omitted upstream. No persistence or reload parsing defect was observed. |
| `persistedCitation` | The same empty sourced-sentence list means there is no accepted citation to persist. `runTurn` inserts citation rows through `repo.appendSentence` only for released references. The withholding notice uses `repo.append`. The database correctly contains zero citations. The original draft citations and their validity are unknown. |

The three original failures share the absence of a sourced release. The demonstrated implementation defect is the smoke diagnostic that conflated progress and answer quality. `scripts/phase2-smoke.ts` now checks actual progress ordering, then independently requires a sourced answer after search for overall success. Official-version, persistence and budget requirements remain mandatory. It also records normalized search hits before evidence selection and final synthesis text before validation in future ignored smoke receipts. It captures no request headers or provider envelopes. The production source selector, release gate, SSE transport and persistence were left intact.

`tests/integration/phase2-smoke.test.ts` adds a deterministic scenario based on the older official release heading. Its draft is invented, since the live draft was not retained. Before the fix it reproduced the false progress failure with the original six-event pattern. The corrected behavior requires progress to pass, the unsupported version to stay out of the answer, citations to remain empty, and the overall smoke to fail. The positive smoke test still requires a sourced result with a persisted citation.

The original files were read without writes. Their SHA-256 values are `e4301479ec97e4c98b6083155d9cc6e657bd8b3b5fde4db1a83e9d9b56cd10bd` for `result.json`, `41c3cefd5b46ff9acbe9e450932d44cd67f0e0b82ef2a1d075adb4dd5b0b40bd` for `attempts.jsonl`, and `1b100976fba003434493289a160f4a68347c22e09f8f0c3b724991be20a5e15b` for `continuum.db`. They remain in the ignored `tmp/phase2-live-smoke/` directory.

## Targeted correction and separately authorized retest

The production selector filters navigation, empty separators and common boilerplate, preserves headings and original table rows with their column labels, and ranks candidate passages using both the original user question and the model's search query. It keeps useful governing headings and emits chosen passages in source order. Source limits, the two-or-three-passage limit, and per-passage character limits are unchanged. Evidence IDs are assigned to that ordered text and shared by the prompt, citation validator, storage and reload. The ranking adds no provider requests. The release gate is unchanged.

Three labeled synthetic tests reproduced the old selector's shortcomings and passed after the change. They cover releases with a distracting compiler version and acknowledgements, pricing with plan and billing columns, and product specifications with unrelated numbers. A synthetic older-release test also exposed that the original smoke could accept a historical version despite a correct, durable citation. The smoke now requires affirmative recency wording and the same exact 24.x version in a cited official passage and the reloaded answer. This is a conservative screening check. Read the live evidence for applicability and recency. The original full search results were unavailable, so these tests are not an exact replay.

TypeScript, ESLint, SQLite integrity, frozen corpus checks and **43 Vitest tests across seven files** passed after the correction. The Vitest run used one worker, masked credentials and a loopback-only Node fetch guard. It included real HTTP SSE and mocked smoke transport, reservation, duplicate-run refusal, 429 termination without retry, progress without a sourced answer, and citation persistence. The managed npm verification was interrupted by automatic review over an external Visual Studio telemetry connection. Run stock CI and teardown natively on the new revision using the earlier block. A scan of 78 committed blobs and 29 working-tree files found no matches for configured secrets, recognizable provider key formats or prohibited artifact paths. All five frozen fixture hashes matched.

The native Playwright result file showed `passed` at 14:48:56 IST, before the corrected implementation commit at 14:49:22 IST. The separately authorized retest then ran against the clean commit.

| Attempt | Gemini | Tavily | Groq | Result |
|---|---:|---:|---:|---|
| Original | 2 | 1 | 0 | Three HTTP 200 responses. The application completed the turn with a limitation after withholding an unsupported statement. |
| Retest | 1 | 0 | 0 | Exit code 1. `turn.started` then `turn.error` with `PROVIDER_UNAVAILABLE` and no partial answer. |

For the retest, the journal recorded the Gemini tool-selection dispatch at 09:19:36.029 UTC and a failure at 09:19:44.033 UTC, 8,004 ms later. There was no HTTP response record. SQLite persisted one `generation` attempt with `outcome=first_byte`, `http_status=NULL`, and `latency_ms=8017`. The turn ended after 8,031 ms without a provider chunk. Empty search and synthesis diagnostics match the recorded sequence. The isolated database integrity check returned `ok` and the persisted terminal state matched the reload. The available evidence establishes the application first-byte timeout. It does not distinguish slow upstream processing from a stalled network, and supplies no evidence of HTTP throttling, rejection, or an implementation-integrity regression.

Both ignored receipt directories were inspected read-only. The retest SHA-256 values are `b9f077c73a888477361b9154734e2014a12e35162002a32b4821bac11803f157` for `result.json`, `5bbfa505fd3d06a3dc535fb576a7b05cac536137b977830b3d6787fa13771780` for `attempts.jsonl`, and `03a2eaed0926c8fdee72d3207e53b84963258c85efcc647109fcad766f0c260d` for `continuum.db`. Both allocations are closed. A successful grounded live answer remains outstanding, and the owner authorized independent offline Phase 3 work.
