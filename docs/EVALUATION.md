# Continuum: evaluation methodology

*Status: **FROZEN v1.1**, 2026-11-18. v1.1 corrects the fixtures (E01–E03), adds a paraphrase and distractor suite (E02), a minimum live evaluation (E04) and staged live budgets (E05). v1.0 is in `v1.0/EVALUATION.md`.*

The fixtures in §2–§3 and the scenarios in §5 are committed in Phase 0 (task 0.7), **before** any resolver or retrieval code exists. Later changes are logged in `docs/DECISIONS.md` with a reason, and reported in the results.

## 1. Principles

- **Two tiers.**
  - **Deterministic** (no network, CI): resolver, retrieval, validators, and the engine with mocked models.
  - **Live** (real providers; run manually, within the budgets in §7).
- **Mock-provider results are never evidence of real LLM accuracy.** They test our code paths only.
- Every reported number comes from a committed results file generated from raw transcripts.
- Failures are reported alongside successes. Cases are never removed after the fact.
- The three challenge prompts are a minority of the cases.

## 2. Resolver cases (deterministic)

**Default context:** now = **Tue 2026-11-17 10:00 Asia/Kolkata** (04:30Z). Expected output is local-day labels plus UTC half-open intervals. For IST, a local day `d` is `[d−1 18:30Z, d 18:30Z)`.

**Rule (E01):** a date without a year resolves to its most recent occurrence **on or before today**. A date with an explicit future year gives no interval and the flag `future`.

| ID | Input | Expected |
|---|---|---|
| T01 | "on 3 November" | 2026-11-03 → [2026-11-02T18:30Z, 2026-11-03T18:30Z) |
| T02 | "Nov 3rd" | same as T01 |
| T03 | "on 30 December" | 2025-12-30 (most recent past occurrence; unchanged from v1.0, consistent with the rule) |
| T04 | "yesterday" | 2026-11-16 |
| T05 | "on Monday" | 2026-11-16 |
| T06 | "last Tuesday" | 2026-11-10 |
| T07 | "last Tuesday", now = Thu 2026-11-19 10:00 IST | 2026-11-17, alternate 2026-11-10 |
| T08 | "on Tuesday", now = Tue 2026-11-17 | 2026-11-17 (includes today) |
| T09 | "last week" | 2026-11-09 … 2026-11-15 |
| T10 | "this week" | 2026-11-16 … 2026-11-17 |
| T11 | "two weeks ago" | 2026-11-03 |
| T12 | "3 days ago" | 2026-11-14 |
| T13 | "in October" | 2026-10-01 … 2026-10-31 |
| T14 | "this month" | 2026-11-01 … 2026-11-17 |
| T15 | "since Friday" | [2026-11-12T18:30Z, now) |
| T16 | "since our last discussion" | DB-backed (ARCHITECTURE §5.4); resolver returns flag `sinceLast` |
| T17 | "on 2 November", tz America/New_York | [2026-11-02T05:00Z, 2026-11-03T05:00Z) |
| T18 | "on 1 November", tz America/New_York | [2026-11-01T04:00Z, 2026-11-02T05:00Z) (25-hour day; DST ends 1 Nov) |
| T19 | "what's the latest Node version?" | No interval |
| T20 | "on 20 November" | **2025-11-20** (v1.0 said "future → no range"; that contradicted the rule) |
| T21 | "on 20 November 2026" | No interval; flag `future` |
| T22 | "the Monday before this one" | 2026-11-09 |
| T23 | "Monday before last" | 2026-11-09 |
| T24 | "on 17 November" | 2026-11-17 (today is "on or before today") |
| T25 | "yesterday", tz America/Los_Angeles (now = Mon 16 Nov 20:30 PST) | 2026-11-15 → [2026-11-15T08:00Z, 2026-11-16T08:00Z) |
| T26 | "yesterday", now = Tue 2026-11-17 00:05 IST | 2026-11-16 → [2026-11-15T18:30Z, 2026-11-16T18:30Z) (midnight boundary) |
| T27 | "on 1 November", tz America/Los_Angeles | [2026-11-01T07:00Z, 2026-11-02T08:00Z) |
| T28 | "what did I ask on Monday 16 Nov at noon?" | 2026-11-16; the time of day is ignored (not supported) |

All weekdays and DST offsets above were checked with `Intl.DateTimeFormat` on 2026-11-18.

## 3. Retrieval (deterministic)

### 3.1 Corpus (`eval/fixtures/corpus.json`)

All conversations are in workspace `lab` with tz Asia/Kolkata unless noted. Times are logical, in IST, with UTC in brackets where it matters. Answers are short and authored. "Checkable" means the answer contains statements a reverification could check.

| Conv | Logical time (IST) | Topic | Checkable |
|---|---|---|---|
| C01 | Mon 16 Nov 11:00 | CRM shortlist for a 20-person sales team: HubSpot, Pipedrive, Zoho CRM, Freshsales, Close, with prices | yes |
| C02 | Tue 10 Nov 15:00 | Postgres hosting: Neon, Supabase, Railway pricing | yes |
| C03 | Tue 10 Nov 18:30 | Weekend trip packing tips | no |
| C04 | Tue 3 Nov 09:15 (= 3 Nov 03:45Z = **Mon 2 Nov 22:45 in New York**) | Latest Node.js LTS version | yes |
| C05 | Tue 3 Nov 20:00 | Postgres connection pooling explained | no |
| C06 | Wed 11 Nov 12:00 | "Managed database providers for side projects" (Neon, PlanetScale) | yes |
| C07 | Fri 13 Nov 16:00 | Python vs TypeScript for scripting (opinion) | no |
| C08 | Mon 9 Nov 10:00 | CRM email-integration question (how-to) | no |
| C09 | Thu 15 Oct 14:00 | Vector database pricing (Pinecone, Weaviate) | yes |
| C10 | Mon 2 Nov 01:30 (= Sun 1 Nov 20:00Z) | GPU cloud pricing | yes |
| C11 | Sat 14 Nov 19:00 | Who is the current CEO of GitHub | yes |
| C12 | Mon 16 Nov 17:00 | Separate conversation: "add Attio to the CRM list", with its price | yes |
| C13 | Mon 16 Nov 12:00, **workspace `live`** | Isolation check (CRM topic): must never appear in lab results | yes |
| C14 | Mon 26 Oct 10:00 | Large language model API pricing: Gemini Flash vs Claude Haiku per million tokens | yes |
| C15 | Tue 27 Oct 14:00 | Object storage: Amazon S3 vs Cloudflare R2 egress fees | yes |
| C16 | Wed 28 Oct 09:00 | Email deliverability tools: Postmark vs SendGrid pricing | yes |
| C17 | Thu 29 Oct 16:00 | Bun vs Deno vs Node startup time | yes |
| C18 | Fri 30 Oct 11:00 | Apartment rent in Bengaluru: Indiranagar vs HSR Layout | yes |
| C19 | Sat 31 Oct 13:00 | Static site hosting: Netlify vs Vercel free tier limits | yes |
| C20 | Sat 24 Oct 18:00 | How to cook dal makhani (recipe) | no |

**Authoring constraints.** These keep the paraphrase cases honest. Phase 0 checks each one with a script.
- C06 never contains "Postgres".
- No conversation other than C02 and C05 contains "Postgres", and none other than C05 contains "pool" or "pooling".
- C04 contains "Node" and "version". C17 contains "Node" but not "version".
- C10 contains "GPU" and "pricing". C11 contains "GitHub" and "CEO".
- C14 says "large language model", never "LLM", and contains "Gemini".
- C15 says "egress fees", never "bandwidth" or "charges".
- C16 never contains "transactional" or "services".
- C17 says "startup time", never "boot", "JS" or "JavaScript".
- C18 says "apartment", "rent" and "Bengaluru", never "flat" or "Bangalore".
- C19 contains "Netlify", "Vercel", "free tier" and "static site".
- C20 contains "cook" and "dal makhani", never "biryani".
- No conversation contains "Kafka", "Kubernetes" or "Heroku".

### 3.2 Queries (`eval/fixtures/retrieval-queries.json`)

Default context: now = Tue 17 Nov 10:00 IST, workspace `lab`, tz IST, and the query is a new turn in a new conversation.

**FOUND\*** = `FOUND_WITH_BASELINE ∨ FOUND_NO_BASELINE` (E03). An exact state is given where the distinction matters. "Required" episodes must be returned; "bonus" episodes are not penalised.

| ID | Query | Gold state | Gold episodes |
|---|---|---|---|
| Q01 | What did I ask you on 3 November? | FOUND\* | C04, C05 |
| Q02 | What did we discuss on 10 Nov? | FOUND\* | C02, C03 |
| Q03 | What did I ask on 5 November? | EMPTY_RANGE | nearest: Nov 3, Nov 2, Nov 9 (v1.0 listed only two) |
| Q04 | What did I ask on 12 Nov? | EMPTY_RANGE | nearest: Nov 11, Nov 13, Nov 10 (tie with Nov 14 → earlier) |
| Q05 | On Monday we shortlisted CRM tools; has anything changed? | FOUND_WITH_BASELINE | C01, C12 (merged; same interval, shared term) |
| Q06 | Last Tuesday I asked about Postgres hosting; has pricing changed? | FOUND_WITH_BASELINE | C02 |
| Q07 | Last Tuesday I asked about Kafka | NO_CONFIDENT_MATCH | lists the in-range topics of C02 and C03; must not claim no conversation |
| Q08 | What did I ask yesterday? | FOUND\* | C01, C12 |
| Q09 | What did we talk about two weeks ago? | FOUND\* | C04, C05 |
| Q10 | The Postgres discussion from last week | FOUND\* | C02 required; C06 bonus |
| Q11 | What did you tell me about Pinecone? | FOUND\* | C09 |
| Q12 | The Node version you told me, is it still right? | FOUND_WITH_BASELINE | C04 (C17 must not match: 1 of 2 terms) |
| Q13 | Those managed database options for side projects | FOUND\* | C06 |
| Q14 | Is the Postgres answer still correct? (no date) | AMBIGUOUS | options ⊇ {C02, C05} (tie on matched terms) |
| Q15 | What did I ask about Kubernetes? | NO_CONFIDENT_MATCH | none; non-categorical wording |
| Q16 | What did I ask in October? | FOUND\* | C09, C14, C15, C16, C17, C18, C19, C20 |
| Q17 | What has changed since our last discussion? | FOUND\* | C12 (newest completed episode; C01 shares a topic term, so not ambiguous; ARCHITECTURE §5.4) |
| Q18 | What did I ask on 2 November? | FOUND\* | C10 |
| Q19 | What did I ask on 2 November? (tz America/New_York) | FOUND\* | **C04** (v1.0 said EMPTY_RANGE; that was wrong, because C04 is 22:45 on 2 Nov in New York) |
| Q20 | What did I ask on 1 November? (tz America/New_York) | FOUND\* | C10 |
| Q21 | Is your answer about GitHub's CEO still right? | FOUND_WITH_BASELINE | C11 |
| Q22 | What did I ask on Monday about CRMs, the Monday before this one? | FOUND\* | C08 ("the Monday before this one" = Nov 9; T22) |
| Q23 | What did we discuss this month about CRMs? | FOUND\* | C01, C08, C12 |
| Q24 | Is the packing advice from last Tuesday still valid? | FOUND_NO_BASELINE | C03 |
| Q25 | What did I ask on 30 December? | EMPTY_RANGE | nearest: Oct 15, Oct 24, Oct 26 (2026) |
| Q26 | Summarise everything since Friday | FOUND\* | C07, C11, C01, C12 |
| Q27 | What did I ask on Monday 16 Nov? (v1.0's "at noon" removed: hours aren't supported) | FOUND\* | C01, C12; **must not include C13** (live) |
| Q28 | What did you say about GPU prices? | FOUND\* | C10 |
| Q29 | Which of your previous recommendations are no longer valid? (P1) | FOUND\* (bounded scan) | the 5 most recent checkable episodes within 30 days: C12, C01, C11, C06, C02 |
| Q30 | hello | NOT_REQUESTED | — |
| Q31 | What did I ask yesterday? (tz America/Los_Angeles; now = Mon 16 Nov 20:30 PST) | FOUND\* | C01 only (C12 is 16 Nov 03:30 PST, which is "today" there) |
| Q32 | What did I ask today? (now = Tue 17 Nov 00:05 IST) | EMPTY_RANGE | — (midnight boundary; nearest: Nov 16, Nov 14, Nov 13) |
| Q33 | What did I ask today? (default now) | EMPTY_RANGE | — (**the current request itself is excluded**, F11) |

*Q29 note:* the window starts 18 Oct. The checkable episodes, most recent first, are C12, C01, C11, C06, C02, C04, C10, C19, … The cap of 5 keeps C12, C01, C11, C06 and C02, and the UI must state the cap. (v1.0 omitted C12 and had no checkability column.)

### 3.3 Paraphrase and distractor suite (E02)

These cases have no date unless stated, so the open confidence rule applies (ARCHITECTURE §5.3). They are frozen with the corpus.

| ID | Query | Tests | Gold state | Required |
|---|---|---|---|---|
| P01 | What did you say about LLM API costs? | acronym + synonym | FOUND\* | C14 |
| P02 | The token pricing for Gemini you looked up | entity reference | FOUND\* | C14 |
| P03 | Remind me what you found on S3 egress | entity + attribute | FOUND\* | C15 |
| P04 | What did we conclude about cloud storage bandwidth charges? | low lexical overlap | FOUND\* | C15 |
| P05 | The transactional email services you compared | synonym | FOUND\* | C16 |
| P06 | Is your SendGrid answer still valid? | entity, reverify | FOUND_WITH_BASELINE | C16 |
| P07 | Which JS runtime boots fastest, what did you say? | low overlap | FOUND\* | C17 |
| P08 | The Bun vs Deno thing | entity reference | FOUND\* | C17 |
| P09 | The flat rent comparison in Bangalore | synonyms (flat, Bangalore) | FOUND\* | C18 |
| P10 | Free hosting limits for my static site, still right? | attribute, reverify | FOUND_WITH_BASELINE | C19 |
| P11 | What did you tell me about Heroku pricing? | related-topic distractor | NO_CONFIDENT_MATCH | none (must not return C19, C02 or C14) |
| P12 | What did you say about cooking biryani? | shared-word distractor | NO_CONFIDENT_MATCH | none (must not return C20) |
| P13 | What did I ask about Postgres pooling in October? | date-boundary distractor | NO_CONFIDENT_MATCH | none (C05 is in November) |
| P14 | The Vercel limits you mentioned | entity reference | FOUND\* | C19 |
| P15 | What did you tell me about rent prices? | attribute reference | FOUND\* | C18 |

**Metrics.**
- **Paraphrase recall:** required episode returned, over the 12 positive P cases.
- **Distractor false-match rate:** over P11–P13, plus the absent cases in §3.2.

**P2 gate (embeddings).** FTS5 stays if **paraphrase recall ≥ 8/12 and the false-match rate is 0**. Otherwise Codex reports the failing cases to the owner with the measured numbers. Embeddings are proposed only then.

Lexical FTS is expected to miss some cases: P01, P04, P07 and P09 are designed to be hard. The gate decides with evidence.

### 3.4 Metrics (whole retrieval suite)

- **State accuracy:** exact state, or the FOUND\* predicate where the gold uses it.
- **Episode-set recall and precision** over required episodes.
- **False-memory rate:** episodes returned when gold says none (Q03, Q04, Q15, Q25, Q32, Q33, P11–P13). **Target 0.**
- **Isolation:** Q27 never includes C13.
- **Timezone set:** Q18–Q20, Q31, Q32 all pass.

## 4. Baseline (fair comparison, C6)

**B0 "conventional agent"** is the same as Continuum except for memory and validation.

| | B0 | Continuum |
|---|---|---|
| Model and fallback order | Same | Same |
| Search provider and settings | Same | Same |
| Budgets (generations, rounds, queries, attempts) | Same | Same |
| Token cap | Same | Same |
| Routing | Same lexicon | Same lexicon |
| Memory | The last N messages of the **current conversation**, with timestamps, plus date and tz in the system prompt | Temporal episodic retrieval |
| Temporal resolver, cross-conversation retrieval, release gate, compare validator | None | Yes |

- **B0-same-thread:** the history is inside the current conversation. This is the fairest setting for B0.
- **B0-new-thread:** the realistic case. It is reported, but **not presented as a finding about B0's reasoning**, because B0 structurally lacks access.
- **B1** (Continuum without the date filter) runs on the deterministic suite only.

## 5. Live scenarios (Timeline Lab, real providers)

Each multi-day scenario creates its history by **really asking** the setup question in the Lab, then moves the clock, then asks the test question. No authored history is used.

**Achievability under the Lab contract (E03).**
- On an **empty** Lab, "set start" may pick any date.
- After that, the Lab only advances forward.
- Each scenario starts from a reset.

| ID | Category | Setup → clock → test |
|---|---|---|
| L01 | Chat | "hi, how are you?" (expect `chat_plain`, 0 searches) |
| L02 | Conceptual | "Explain what a B-tree index is in two sentences." (expect `undecided`, 0 searches) |
| L03 | Current fact | "What's the latest Node.js LTS version?" (expect `research`) |
| L04 | Multi-entity research | "Compare current entry-level pricing for Neon, Supabase and Railway Postgres." (expect all 3 entities covered or reported missing) |
| L05 | Recent news | "What did Vercel announce this month?" |
| L06 | **Official (a)** | Start = a Monday → "Shortlist 5 CRM tools for a 20-person sales team, with prices" → +3 days → "On Monday we shortlisted 5 CRM tools… changed pricing or shipped something big since?" |
| L07 | **Official (b)** | Start = Tue 3 Nov 2026 → a factual question → advance to Tue 17 Nov 2026 → "What did I ask you on 3 November? Is your answer still correct today?" |
| L08 | **Official (c)** | Start = a Tuesday → "Compare Postgres hosting pricing: Neon, Supabase, Railway" → +7 days → "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?" |
| L09 | Unrelated historical recall | Two unrelated topics on two days → "What did I ask on <date>?" (only that day's) |
| L10 | Relative recall | → "What did we discuss last week?" |
| L11 | Paraphrase recall | "managed DBs for side projects" → +5 days → "the Postgres options you gave me, still valid?" |
| L12 | Non-price reverification | "Who is the CEO of GitHub?" → +7 days → "Is that still true?" |
| L13 | Version reverification | "Latest stable Python?" → +14 days → "still correct?" |
| L14 | Missing memory, explicit target | Empty Lab → "On Monday we shortlisted HubSpot and Pipedrive. Any pricing changes?" (no invented Then; current info given) |
| L15 | Ambiguous referent | Two research topics on the same day → "Is that answer from Tuesday still right?" (expect clarify, then a selection continues it) |
| L16 | Incomplete evidence | A niche product → reverify (expect `unverified` rows and a useful partial answer) |
| L17 | Conflicting sources | A topic chosen by the owner with a browser search in Phase 2 (no API credits), and logged |
| L18 | Same-thread follow-up | "those five tools: which has the best free plan?" |
| L19 | Since last discussion | → "What has changed since our last discussion?" |
| L20 | Recommendations scan (P1) | After L06, L08, L12 → "Which of your previous recommendations are no longer valid?" |
| L21 | Cancellation | Stop during research → partial saved, UI recovers |
| L22 | No keys | Boot without keys → recall works, model paths say NOT_CONFIGURED (no requests) |
| L23 | Provider fallback | **Mock-only** (Tier 1). No deliberately invalid live requests (F05). |
| L24 | Search unavailable | `TAVILY_API_KEY` unset (no request sent) → code-written "couldn't search" line; checkable claims withheld |

### 5.1 Minimum live evaluation: required for submission (E04)

**Scenarios:** L01, L03, L06, L07, L08, L09, L12, L14. That covers the official three, ordinary chat, current research, unrelated recall, missing memory, and non-price reverification.

**Runs:**
- Continuum: once.
- B0: same-thread and new-thread for L06, L07, L08 and L12; once for the rest.

**Reported:** every failure, every turn's generations, attempts, searches, Tavily credits and timings.

### 5.2 Full live evaluation: preferred, budget permitting

All of L01–L22 and L24, with the baseline subset L01, L03, L04, L06, L07, L08, L11, L12, L14, L15, L16, L19.

## 6. Scoring (live)

**Claim-level scoring (E04).** The owner splits each test answer into claims, using saved transcripts (`eval/runs/<timestamp>/*.json`) that include evidence and memory events. Each claim is labelled:

| Label | Meaning |
|---|---|
| `correct_sourced` | True, and supported by a cited source |
| `correct_unsourced` | True, but no valid source |
| `incorrect` | False (numeric **or** non-numeric) |
| `unsupported` | Can't be determined from the cited sources |
| `invented_history` | Any Then value or past question not in stored history (**critical**) |

Per answer, the owner also records:
- `omitted_entities`: requested entities missing from the answer;
- `correct_abstention`: yes or no where abstention was right;
- an overall grade: Correct / Partially correct / Wrong.

**Auto-computed per run:**
- Generations, physical attempts, searches and Tavily credits per turn (mean and max).
- Latency (first progress, first answer text, total) per route class: median and max. With n < 20 per class, report max instead of p90, and say so.
- Withheld statements per research answer; `no_source` sentences per answer.
- Verdict disagreements (model vs code).
- Coverage: requested vs supported entities.
- Failure rate by terminal code.

**Not claimed:** any "correctness rate" from code checks alone. Results are stamped with date, commit, model IDs and Lab/real dates.

## 7. Live budgets (E05)

**Verified 2026-11-18** (docs.tavily.com/documentation/api-credits):
- The free plan has 1,000 credits a month.
- Basic search costs 1 credit and advanced costs 2.
- The page does not say whether failed searches are charged, so **count them as charged**.

Request settings: always `search_depth:'basic'` explicitly, no `auto_parameters`. A 429 retry counts as another credit.

| Stage | Tavily credits | Gemini requests | Authorised by |
|---|---|---|---|
| Phase 0 qualification | ≤ 5 | ≤ 24 | This handoff (hard cap, ledgered) |
| Phase 1 manual check of chat path | 0 | ≤ 10 | This handoff |
| Development, Phases 2–5 (manual live checks) | ≤ 100 | ≤ 150 | This handoff |
| MVP smoke: L06–L08 | ≤ 60 | ≤ 40 | This handoff |
| Minimum live evaluation (§5.1): Continuum + B0 | ≤ 150 | ≤ 120 | This handoff |
| Full live evaluation (§5.2): one Continuum run + baseline subset | ≤ 320 | ≤ 250 | **Owner approval before starting** |
| Corrective re-runs | ≤ 150 | ≤ 120 | **Owner approval before starting** |
| Unallocated reserve | ≥ 215 | — | Never used without the owner |

- Each live stage writes its actual usage to `eval/budget.md`. Stages never borrow from each other without the owner.
- **Gemini daily limits are per model and per project, and are not verified by us.** The owner reads them from AI Studio's rate-limit page in Phase 0, and they are recorded in `docs/PROVIDER-QUALIFICATION.md`.
- Rate-limit errors are recorded as failures, not hidden.

## 8. Tier 2: Playwright (fake providers, one worker locally)

1. Smoke: send → stream → reload → persists (Phase 1).
2. Research progress + sources.
3. Deterministic recall in the Lab with no keys.
4. Clarify buttons → selection continues the original request.
5. Then vs Now card with all six verdict badges and both bases (fixture).
6. Stop mid-stream.
7. Error banner + retry (P1).
8. Lab advance / reset (reset doesn't touch Live; Lab busy → 409 message).
9. XSS fixture: an evidence title with `<script>` renders inert.
10. Keyboard-only flow + axe accessibility check.

**Local resource use:** `workers: 1`, Chromium only, headless.
