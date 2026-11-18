# Continuum v1.1: correction matrix

*2026-11-18. This applies ChatGPT's independent review (verdict: CONDITIONAL GO) to the v1.0 handoff. v1.0 is preserved unchanged in `v1.0/`. Section references are to the v1.1 files:*
- *A = ARCHITECTURE.md*
- *E = EVALUATION.md*
- *P = IMPLEMENTATION-PLAN.md*
- *S = CONTINUUM-SPEC.md*
- *X = CODEX-PHASE-0-1-PROMPT.md*

**Phase** says when the fix is built: **0–1** means Codex builds it now; **Later** means it is a contract for Phases 2–5.

## Findings F01–F20

| ID | Finding | Resolution | Where | Phase | Evidence / test |
|---|---|---|---|---|---|
| F01 | bm25 sign; no calibrated confidence | `rel = −bm25()` is used only to order already-confident candidates. Confidence is a term-coverage rule; ambiguity is a tie on matched terms. No ratios. | A §5.3 | Later (sign check 0–1) | Verified locally on 2026-11-18: matches score negative, lower is better. `check-sqlite` asserts it. Q05, Q06, Q07, Q12, Q14, P01–P15 |
| F02 | Timezone-correct retrieval | Local days → UTC half-open intervals per request tz, filtered on `logical_at`; index `(workspace, logical_at)`; `local_date` is display only | A §4, §5.1 | Schema 0–1; resolver Later | T17, T18, T25–T27; Q18–Q20, Q31, Q32 |
| F03 | Comparison correctness | Code-derived numbers (model's number cross-checked only); essential vs material qualifiers; unknown essentials → incomparable; side-specific value presence; dedupe; multi-observation rule; code-derived denominator; dropped items counted | A §8.1–8.5 | Later | P 5.3 table-driven tests |
| F04 | Logical vs real time in "change" claims | `basis` = `claim_only` ("differs from my earlier answer") vs `evidence`; intervals from real `retrieved_at`/`published_at` only; "fetched minutes apart" wording; `logical_at` never enters an interval | A §3.3, §8.6 | Later | P 5.3 tests |
| F05 | Provider budgets | One committed ledger across doctor runs, ledgered before dispatch, refusal at cap; `maxRetries: 0`; no invalid-key live calls; qualification covers the real execution contract; an exact plan of 21 + 2 | A §9.1, §9.3; P §Phase 0; X | 0–1 | Ledger file; `maxRetries` verified in AI SDK docs (default 2) |
| F06 | Single orchestration owner | One `streamText` per generation, `isStepCount(1)`, tools without `execute`, the engine builds a tool-result message for every `toolCallId`; no `prepareStep`, no SDK loop | A §6.1, §6.4 | Interface 0–1; loop Later | Docs: tools without execute are "not executed automatically". Phase 0 confirms the stream shape. |
| F07 | Routing and safe streaming | Classes `chat_plain` (direct stream), `research` (`toolChoice:'required'`), `undecided` (text held until the step ends); current-info never model-only; Phase 1 adds an honest prefix | A §6.2, §7.3, §14 | Classifier 0–1; rest Later | Classifier tests; Phase 2 held-text tests |
| F08 | Unsupported assertions | Checkable + unsupported → **withheld**, with a code line giving the count; plain, uncited → labelled "no source"; wording "sourced / no source / left out" | A §7.1 | Later | P 2.5 |
| F09 | First-party detection | Replaced by `domain_match` (exact first label only), shown as "site name matches"; never called official; never used to resolve conflicts; no curated DB | A §4, §7.2, §8.4 | Later | — |
| F10 | Evidence coverage | Coverage table (requested → queried → found → supported); per-entity minimum before fill; cap max(8, entities) ≤ 12; ≤ 2 top-up queries; missing entities shown | A §7.2, §8.5 | Later | P 2.4 starvation test |
| F11 | In-flight exclusion | SQL eligibility before ranking: workspace, `logical_at < now`, current `turn_id` excluded, intervals, origin; adjacent expansion stays inside the boundaries | A §5.3 | Later | Q33 (new) |
| F12 | Last-discussion resolution | Newest relevant completed episode by `logical_at`; same-conversation first; clarify on unrelated near-ties | A §5.4 | Later | Q17 (rationale rewritten), L19 |
| F13 | Terminal-state guarantee | Durable vs SSE guarantees separated; `streamSSE` + `onAbort` + request signal; distinct codes; startup recovery → `INTERRUPTED`; a real-HTTP disconnect test | A §4, §10.2 | 0–1 | P 1.3, 1.5; X criteria 4–5 |
| F14 | Persisted idempotency | `turns` table, `UNIQUE(conversation_id, client_turn_id)`, a partial unique index as the durable lock, transactional admission | A §4, §10.1 | 0–1 | P 1.5; X criterion 6 |
| F15 | Referential integrity | `foreign_keys=ON` asserted; composite `(conversation_id, workspace)` FKs; cascades everywhere; orphan and FTS integrity tests | A §4 | 0–1 | Verified locally: workspace mismatch rejected; cascade fires the FTS delete trigger |
| F16 | Lab concurrency | Lab mutex, `409 LAB_BUSY` both ways, `lab_epoch` guard on finalisation | A §3.2, §4 | Schema 0–1; API Later | P 4.1 |
| F17 | Partial-response history | Only `complete`, non-fake answers are baseline-eligible; others visible but `FOUND_NO_BASELINE`; questions always count | A §5.5, §5.6 | Later | Q24, plus a P 3.2 test |
| F18 | Clocks | `LogicalClock` / `WallClock` / `Monotonic`; monotonic deadlines and latency explicitly allowed | A §3.1 | 0–1 | P 1.4 |
| F19 | Clarification continuation | `clarifications` table; `selection {clarificationId, optionIndex}` validated → `pinnedEpisodeId`; no second NL search | A §4, §10.4 | Schema 0–1; flow Later | P 3.3 |
| F20 | Fake data isolation | `origin` on conversations, messages and evidence; fake mode → `continuum-fake.db`; real mode refuses fake rows; sample rows badged | A §4, §12 | 0–1 | P 1.3 |

## Evaluation findings E01–E05

| ID | Finding | Resolution | Where |
|---|---|---|---|
| E01 | Contradictory date cases; compound weekday | One rule: a yearless date → the most recent occurrence **on or before today**; explicit future year → `future`. **T20 corrected** to 2025-11-20; T21 added for an explicit future year. "The Monday before this one" / "Monday before last" defined (T22, T23); Q22 kept. | A §5.1; E §2 |
| E02 | Paraphrase evaluation | Corpus C14–C20 with checked authoring constraints; 15 cases P01–P15 (synonyms, acronym, entity, attribute, low overlap, 3 distractors); gate: recall ≥ 8/12 and 0 false matches, else report to the owner before embeddings | E §3.1, §3.3 |
| E03 | Gold-state consistency | FOUND\* predicate defined. Q27 hour removed. **Q19 corrected** (C04 is 2 Nov 22:45 in New York, so FOUND\* {C04}; v1.0 said EMPTY_RANGE). Q03, Q04, Q25 nearest-day lists fixed with a tie rule. Q29 recomputed with a checkability column (C12 was missing). Q31–Q33 added for tz change, midnight and in-flight exclusion. Lab scenarios made achievable: "set start" on an empty Lab. L23/L24 no longer make invalid live requests. | E §2, §3.2, §5; A §3.2 |
| E04 | Independent live evaluation | A minimum live evaluation (8 scenarios, Continuum + B0) is now part of P0 and the cut line; claim-level labels (incl. non-numeric, omitted entities, invented history); same settings for B0 | E §5.1, §6; S §5 |
| E05 | Live budget controls | Tavily allowance re-verified; staged budgets (qualification, development, MVP smoke, minimum eval, full eval, corrective, reserve ≥ 215); full and corrective runs need owner approval; failed searches assumed charged | E §7 |

## Toolchain findings (section E of the review)

| Item | Resolution | Where |
|---|---|---|
| TypeScript choice | **TS 5.9.3.** Verified: `typescript-eslint` 8.73.0 peer `typescript >=4.8.4 <6.1.0`, so 7.0.2 is incompatible | A §15 |
| Minimum Node | Verified engines: eslint `^20.19 \|\| ^22.13 \|\| ≥24`, vitest `^22.12 \|\| ^24 \|\| ≥26`, ai ≥ 22, concurrently ≥ 22 → **declared `^22.13.0 \|\| ^24.0.0`**. Node 22 is claimed only after an actual run. | A §15; S R8 |
| Environment facts | Codex records them from its own workspace | P 0.1; X |
| Existing directories | Reuse `C:\projects`; stop if `continuum` exists | P header; X |
| Local CI vs Actions | Reported separately | P ground rule 7; X |
| Playwright resources | `workers: 1`, Chromium, headless | E §8; X |

## Where we did not fully agree

- **E01, T03.** T03 ("30 December" → 2025-12-30) was already consistent with the "most recent past occurrence" rule. Only T20 contradicted it. T03 is unchanged; T20 is fixed.
- **F07, `undecided` latency.** Holding text until the step ends costs first-token latency for conceptual questions. We accept this to meet the finding, measure it, and leave the trade-off to the owner (A §14). We did not add a second classifier model call.
- **F08, plain sentences.** Uncited non-checkable sentences are *qualified* ("no source") rather than withheld. That is one of the options the finding allows. Withholding every uncited sentence would gut conversational answers.

## Unchanged from v1.0

Product direction, stack, `node:sqlite` + FTS5-first, the single `web_search` tool, on-demand comparisons without a claim ledger, Timeline Lab, the seven memory states, the six verdicts, local-first reviewer path, and the roles. No new agents, infrastructure, Docker, vector DB or governance documents.
