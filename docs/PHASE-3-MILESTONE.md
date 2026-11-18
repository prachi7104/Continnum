# Continuum Phase 3 milestone

18 November 2026 · `E:\projects\Continuum` · `main`

**Implementation and stock offline CI passed.** The two local commits and first GitHub push are pending. The frozen FTS5 gate passes. Four frozen retrieval cases differ from their JSON expectations. Successful Phase 2 live research remains outstanding.

## Implementation

| Module | Result |
|---|---|
| `server/src/temporal/resolve.ts` | Pure civil-date resolution for absolute dates, lookback, weekdays, compound weekdays, week and month ranges, and since-last references. Converts each boundary in the request's IANA zone to a half-open UTC interval. |
| `server/src/memory/retrieve.ts` | Workspace, origin, turn and UTC-time eligibility. FTS5 Porter matching with negative BM25 scores inverted for ordering, lexical confidence, date alternates, episode grouping, bounded neighbors and ambiguity. All seven memory states are represented. |
| `server/src/memory/render.ts` and `server/src/engine/turn.ts` | Keyless deterministic recall, explicit date and lookup limitations, historical timestamps and provenance, and one buffered extractive synthesis generation with exact historical citation validation. Incomplete and fake answers are excluded as factual baselines. |
| `server/src/db/repo.ts`, `server/src/api/routes.ts`, `shared/events.ts` | Persistent scoped clarification selection and single-use consumption in the admission transaction. Pinned selection skips lexical search. SSE and reload preserve memory metadata. The frozen SQLite schema was reused. |
| `client/src/App.tsx` and `client/src/api.ts` | Historical reference links, timestamps and provenance, clarification buttons that survive reload, and direct recall and limitation responses. |

Historical synthesis selects and orders exact cited sentences. Unmatched paraphrases are withheld. A deterministic recap remains available without model access. Phase 4 and Phase 5 workflows are outside this implementation.

## Frozen evaluation

`node --no-warnings --import tsx scripts/evaluate-memory.ts` evaluated 28 resolver cases and 48 retrieval cases from the 20-episode corpus. The retrieval cases comprise 33 Q cases and 15 paraphrase or distractor cases. [Resolver results](../eval/results/phase-3-resolver.json) and [retrieval results](../eval/results/phase-3-retrieval.json) include each case.

| Metric | Date filter | No-date-filter ablation |
|---|---:|---:|
| Resolver accuracy | 28/28 · 100% | — |
| Memory-state accuracy | 46/48 · 95.83% | 40/48 · 83.33% |
| Micro episode precision | 55/55 · 100% | 38/125 · 30.40% |
| Micro required-episode recall | 55/60 · 91.67% | 38/60 · 63.33% |
| Paraphrase recall | 10/12 · 83.33% | 10/12 · 83.33% |
| False memories across all no-episode, no-match cases | 0/10 · 0% | 6/10 · 60% |
| Workspace isolation and top-tie ambiguity | Pass | Pass |
| Retrieval median / max | 1.431 / 6.675 ms | 1.176 / 10.174 ms |

The FTS5 acceptance floor is 8/12 paraphrases and zero false memories. Q14 surfaced both Postgres candidates even though their BM25 scores differ. Q27 excluded the Live workspace episode. The nearest-day order matched Q03, Q04, Q25 and Q32. Q33 found no historical episode for the current turn. Timing is observed for this local 20-episode run, not a production latency claim.

| Strict date-filter case failures | Observed result |
|---|---|
| Q16 | Six of eight required episodes returned. Section 5.3 caps retrieval at six and the result sets `truncated`. The frozen JSON expects eight. |
| Q31 | Returned C01 only in America/Los_Angeles, matching the frozen evaluation prose and civil date. The frozen JSON's `required` array also includes C12, which is on the following local day. The strict metric counts the missing entry. |
| P05 | `NO_CONFIDENT_MATCH` for the transactional email paraphrase. |
| P07 | `NO_CONFIDENT_MATCH` for the low-overlap JS runtime startup paraphrase. |

The no-date-filter ablation missed Q01, Q02, Q03, Q04, Q05, Q08, Q09, Q10, Q16, Q18, Q19, Q20, Q23, Q25, Q26, Q27, Q31, Q32, Q33, P05, P07 and P13. The underlying fixtures and their five frozen hashes were preserved. The architecture and golden fixture conflicts remain visible in the raw strict score.

## Verification and local history

| Check | Status |
|---|---|
| TypeScript and ESLint | Pass with the pinned toolchain. |
| SQLite and frozen corpus checks | Pass. |
| Full Vitest and real HTTP SSE | 75/75 tests across nine files, one worker, 19.00 s in stock CI. Real HTTP tests cover keyless cross-timezone recall, scoped clarification, reload, incomplete-answer safeguards, and one-attempt historical citation persistence. |
| Stock `npm run ci` and Chromium | Passed on 18 November 2026 with fake providers and provider keys masked. Chromium passed all 3 scenarios in 14.8 s with one worker. Both test-server ports were clear after teardown. |
| PowerShell native commits | Managed Git returned permission denied creating `.git/index.lock`. The worktree has the expected Phase 2 closeout and Phase 3 change sets, with no staged files. |
| Secret and artifact scan | Scanned 107 unique blobs reachable from `main` and all 19 pending files. No configured secret, recognized provider-key or private-key pattern, or prohibited artifact path was found. The native staging path list matches the pending files. |
| Provider budget | Zero Phase 3 requests. Cumulative actual usage is 25 Gemini, 3 Tavily credits and 0 Groq. All earlier allocations are closed. |

History before the two pending local commits, newest first.

| Hash | Commit |
|---|---|
| `de559ca4ef0b27ea018e0fbc4cb37d4aa5cf8602` | feat: add bounded evidence-grounded web research |
| `f600734ea256603896b0f26bf1e3d769d150e7da` | test: make browser teardown reliable and close Phase 1 |
| `6068f5fb93bbb36320d02c05506dcb896c457965` | feat: enable qualified Gemini streaming |
| `e3c81338cd7a789e29528cac55ae88f0ea6252a8` | docs: record live provider qualification |
| `7f2313f482dec3cb222f3246549bdf26b0cd8922` | feat: establish offline Continuum baseline |
| `00a4d3d32d7b5e674e046a382a146ba7ab7cb23f` | chore: freeze Continuum evaluation fixtures |

## Native PowerShell closeout

Run from a native PowerShell session. Stock CI and teardown have already passed for these changes.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
if ((git branch --show-current) -ne 'main' -or (git rev-parse HEAD) -ne 'de559ca4ef0b27ea018e0fbc4cb37d4aa5cf8602') { throw 'Unexpected local branch or HEAD.' }
git diff --exit-code 00a4d3d -- eval/fixtures scripts/check-corpus.ts
if ($LASTEXITCODE -ne 0) { throw 'Frozen fixtures changed.' }
if (@(git diff --cached --name-only).Count) { throw 'Unexpected staged files.' }
git add -- docs/PHASE-2-MILESTONE.md eval/budget.md
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 closeout staging failed.' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }
git commit -m 'docs: close Phase 2 live verification'
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 closeout commit failed.' }
git add -- client/src/App.tsx client/src/api.ts docs/PHASE-3-MILESTONE.md e2e/chat.spec.ts eval/results/phase-3-resolver.json eval/results/phase-3-retrieval.json scripts/evaluate-memory.ts server/src/api/routes.ts server/src/db/repo.ts server/src/engine/turn.ts server/src/evidence/release.ts server/src/memory/render.ts server/src/memory/retrieve.ts server/src/temporal/resolve.ts shared/events.ts tests/integration/memory.test.ts tests/unit/temporal.test.ts
if ($LASTEXITCODE -ne 0) { throw 'Phase 3 staging failed.' }
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Whitespace check failed.' }
git commit -m 'feat: implement temporal reasoning and episodic memory'
if ($LASTEXITCODE -ne 0) { throw 'Phase 3 commit failed.' }
git log -8 --format='%H %s'
git status --short --branch
if (@(git status --porcelain).Count) { throw 'The worktree is not clean.' }
git push -u origin main
if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed. The local commits are saved.' }
git ls-remote --heads origin main
```

Managed staging escalation was rejected because sandbox approvals are disabled. GitHub reported an empty repository. The managed Git credential helper failed to start, and GitHub CLI reported an invalid token. Native PowerShell can use the owner's Git credential prompt or freshly authenticated GitHub CLI session. The failed Phase 2 live acceptance requirement stays recorded.
