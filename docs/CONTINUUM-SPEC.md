# Continuum: product and engineering specification

*Status: **FROZEN v1.1**, 2026-11-18. Owner: Prachi Agarwalla. Companion files: ARCHITECTURE.md, IMPLEMENTATION-PLAN.md, EVALUATION.md, CODEX-PHASE-0-1-PROMPT.md, CORRECTIONS-v1.1.md (what changed from v1.0, and where), OFFICIAL-BRIEF-NOTES.md (verification notes on the challenge brief). v1.0 is kept in `v1.0/`.*

Labels used in this file:
- **[OFFICIAL]**: from the minimi challenge page or the application form.
- **[DECISION]**: an owner or architecture decision.
- **[TARGET]**: a provisional engineering target, to be measured.

## 1. Product

**Continuum is a time-aware research agent.** It remembers what you asked, understands when you asked it, and investigates what has changed since.

It is a chat agent with exactly one model-callable tool, `web_search`. Its distinctive behaviour is reverification: days later, the user can ask whether an earlier answer still holds. Continuum then:
1. finds the right earlier exchange by date and topic;
2. extracts what it said then;
3. researches the current state;
4. shows a validated **Then vs Now** comparison with provenance.

**Differentiators** [DECISION]. The concept is not novel; several public submissions share it. We compete on:
1. accurate temporal memory and reverification that works for any fact, not just prices;
2. Timeline Lab;
3. the Then vs Now experience;
4. measured improvement over a fair baseline;
5. low, predictable latency;
6. reviewer onboarding;
7. honest, concise documentation.

## 2. Verified official requirements

The Notion page was read in full on 2026-11-11 (rendered scrape). The Binary form was re-read on 2026-11-17, and was open with no closed notice. Both were **not** re-read for v1.1. The verification method, dates and limits are in `OFFICIAL-BRIEF-NOTES.md`. The quotes below are short excerpts; the rest is paraphrase.

| ID | Requirement (paraphrased; short quotes only) | Source | Class | How Continuum meets it | Acceptance test |
|---|---|---|---|---|---|
| R1 | Build a chat agent "we can talk to" | Notion | Mandatory | React chat UI with streaming | E2E: send, receive, persist |
| R2 | "It has one tool: web search" | Notion; Form | Mandatory | `web_search` is the only tool registered with the model. Memory, dates and validation are application code. | Unit: tool registry size is 1 |
| R3 | Be as good as the best chat agents with web search today | Notion | Mandatory (quality bar) | Grounded, cited, fast | Live eval |
| R4 | Test set includes: (a) "On Monday we shortlisted 5 CRM tools… changed pricing or shipped something big since?", (b) "What did I ask you on 3 November? Is your answer still correct today?", (c) "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?" | Notion | Mandatory (acceptance) | Paths B and D, Timeline Lab | EVALUATION L06–L08 |
| R5 | Best architecture wins; not first, prettiest or most features | Notion; Form | Judging | — | — |
| R6 | Answers fast, gets things right, is good to talk to | Notion | Judging | Latency budget, validation, UX | EVALUATION metrics |
| R7 | Reviewers chat like a real user, read the code, read DESIGN.md | Notion | Judging | Clean code, one-page DESIGN.md | Owner review |
| R8 | JavaScript or TypeScript on Node | Notion | Mandatory | TypeScript 5.9 (strict); engines `^22.13.0 \|\| ^24.0.0`; Node 24 primary | Local `npm run ci` on Node 24; Node 22 claimed only after an actual Node 22 run |
| R9 | Runs with `npm install` then `npm run dev` | Notion | Mandatory | Single package; `dev` runs server and client | Fresh local clone check (a GitHub Actions run is separate, owner-authorised) |
| R10 | Every API key it needs is listed in `.env.example` | Notion | Mandatory | All env vars documented | Unit test scans `process.env` reads |
| R11 | Any framework (or none), any model | Notion | Permission | — | — |
| R12 | AI coding tools welcome; you must be able to explain every decision | Notion | Mandatory (owner) | Small reviewed phases; owner writes DESIGN.md | Owner walkthrough |
| R13 | Public GitHub repo | Notion; Form | Mandatory | Made public only at submission (owner action) | Logged-out clone works |
| R14 | DESIGN.md, one page: how it works, why, what was considered and rejected, what you'd do with another week | Notion; Form | Mandatory | Owner-written | ≤ 1 rendered page |
| R15 | Submit the repo link via the application form | Notion; Form | Mandatory | Owner action | — |
| R16 | "answer fast, get things right, and remember what you asked and when" | Form | Mandatory | Core design | Eval |
| R17 | Form fields. Required: name, email, LinkedIn, in college?, best three projects (link + hardest part), GitHub link. Optional: 1-minute video, anything else. | Form | Mandatory / optional | Owner fills from career profile; video recommended | — |
| R18 | Rolling, first-come review; no due date; a later submission can still win | Notion; Form | Context | Owner targets: MVP 2026-11-20, submit by 2026-11-23 | — |

**Not official requirements** (our choices only): auth, multi-user, deployment, CI, Playwright, Timeline Lab, specific model or provider.

**Open unknown:** how graders create "Monday" history on a fresh install. Our mitigations are honest empty-memory behaviour plus Timeline Lab. Neither guarantees their workflow.

## 3. Goals

1. **Correct current answers.** Cited, with retrieval dates shown.
2. **Reliable temporal recall across conversations.**
   - Exact dates, relative dates, weekdays, weeks and months, plus "since our last discussion".
   - Seven memory states (five lookup outcomes plus `NOT_REQUESTED` and `ERROR`) that are never confused with each other (ARCHITECTURE §5.2).
3. **Generalizable reverification.**
   - Six code-assigned verdicts: changed, unchanged, incomparable, conflicting, new, unverified. Works for any attribute, not just prices.
   - Every requested item is counted, including failed or omitted ones.
   - A difference from an earlier *answer* is distinguished from an evidenced real-world *change* (ARCHITECTURE §8.6).
4. **Structurally checked output.**
   - Research and comparison answers pass code checks on structure, citations, value presence and verdict rules.
   - Checkable claims without support are withheld, and the answer says so.
   - These checks are structural, not proof of semantic factual support.
5. **Predictable cost and latency.**
   - Bounded model generations, search rounds, queries and provider attempts.
   - A shared deadline per turn.
6. **Reviewer-ready.**
   - Boots without keys.
   - `npm run doctor`.
   - Timeline Lab, with an optional labelled sample dataset.

## 4. Non-goals and anti-goals

**Non-goals:**
- Accounts or auth
- Hosted deployment (deferred)
- Docker
- Vector databases
- Local LLMs
- Voice
- Proactive notifications (listed under "another week")
- An analytics dashboard

**Anti-goals** (failures even if the feature "works"):
- Inventing a past conversation, or a value the agent supposedly said earlier.
- Saying "no conversation exists" when only lexical retrieval came back empty.
- Treating "no news found" as "unchanged".
- Stating when a change happened without evidence for it.
- Presenting simulated (Lab) time as the time evidence was retrieved.
- Simulated or fake AI or search output that is not labelled as such.
- Releasing unsupported checkable claims as ordinary answer text, even with a visual mark.
- Answering an explicit current-information question from the model alone without saying so.
- Presenting a difference from an earlier answer as a proven real-world change, or dating a change from simulated time.
- Letting a model that drops a hard item improve the headline.
- Calling a source "official" or "first-party" because its domain contains a product name.
- Fake or test output that persists indistinguishably from real history.
- Searching for small talk.
- Silently falling back to paid usage.
- Hiding provider failures.
- Claims in docs or UI that we haven't measured ("zero hallucination" and the like).

## 5. User-facing capabilities (frozen scope)

**P0, required for the MVP:**
- Chat with streaming
- Conversation sidebar
- Persistence across restarts
- Web research with sources
- Temporal recall, including the zero-generation deterministic recall answers
- All seven memory states (ARCHITECTURE §5.2)
- Clarify when the reference is ambiguous
- Path D Then vs Now with all six verdicts
- Stop button
- Typed error states
- Timeline Lab: clock, advance, reset, labelled sample data
- Boots with no keys
- `npm run doctor`
- Tier 1 tests
- One Playwright smoke test
- CI workflow file plus local `npm run ci` (a GitHub Actions run needs the owner's push)
- **Minimum live evaluation against the baseline** (EVALUATION §5.1)

**P1, after P0 is solid:**
- Full Playwright suite
- Full live evaluation against the baseline (EVALUATION §5.2)
- Retry
- Optional execution-details disclosure
- "Which previous recommendations are no longer valid?" (bounded scan)
- Memory drawer showing the original exchange

**P2, only with measured justification:**
- Embedding or hybrid retrieval: only if the paraphrase-recall metric fails its gate (EVALUATION §3.3)
- An LLM semantic verifier pass
- Full-page fetching
- A cross-turn search cache
- A Groq fallback provider

**Cut line if time runs short:** P0 (which includes the minimum live evaluation, with real failures, costs and timings) + the Tier 1 deterministic suite results + DESIGN.md. Mock-provider tests alone are never presented as evidence of answer quality.

## 6. Constraints

- **Development machine:** Windows 11, 7.7 GB RAM (about 1 GB free during checks), Node 24.11.0, npm 11.6.1, Git 2.46.2. These figures were observed by Claude on 2026-11-17. **Codex re-records them from its own workspace in task 0.1.**
- **Reviewer machines:** unknown, probably macOS.
- **Paid services:** none without owner approval. Free Gemini API key (AI Studio, project without billing) and free Tavily key (1,000 credits a month).
- **Commits:**
  - The owner is the sole author.
  - **No AI co-author trailers** and no "generated with" lines.
  - No remote pushes without owner instruction.
- **The owner must be able to explain all code (R12).** Prefer few dependencies and plain code over abstractions.

## 7. Glossary

- **Logical time**: conversation time. It equals real time in the Live workspace, and is simulated in Timeline Lab.
- **Retrieved-at**: the real wall-clock time a web result was fetched. It is never simulated.
- **Published-at**: the provider's estimate of when a source was published, when available.
- **Episode**: a user message plus its assistant answer, along with the adjacent turns.
- **Baseline answer**: the historical assistant answer being reverified.
- **Generation**: one model request that produces output. A **physical attempt** is any API request, including retries and fallbacks.
- **Baseline-eligible**: a completed, non-fake assistant answer that may be used as the Then side (ARCHITECTURE §5.5).
- **Basis**: whether a Then vs Now row rests on historical evidence (`evidence`) or only on the earlier answer (`claim_only`).
