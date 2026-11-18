# Official challenge brief: verification notes

*2026-11-18. These notes support CONTINUUM-SPEC §2 (R1–R18). They are not a copy of the brief.*

## Sources

| Source | URL | Last read | How |
|---|---|---|---|
| minimi hiring challenge (Notion) | https://app.notion.com/p/minimi-hiring-challenge-build-a-chat-agent-4100a8b933b181b98277d8ea5a534d6f | 2026-11-11 | Full rendered scrape (the page needs JavaScript) |
| Application form (Binary) | https://binary.so/YIrD8L5 | 2026-11-17 | Rendered read; the form was open, with no closed notice |

**Neither source was re-read for v1.1.** If either page changes, the spec may be stale.

## What the brief requires (paraphrase, with short excerpts)

- **The task:** build a chat agent "we can talk to" that has one tool, web search. It should be as good as today's best chat agents with web search.
- **Three example test prompts** (paraphrased; their exact wording is in R4):
  - CRM tools shortlisted "on Monday": have they changed pricing or shipped something big since?
  - What did I ask on 3 November, and is the answer still correct?
  - Postgres hosting asked about "last Tuesday": has pricing changed since?
- **Judging:** the best architecture wins, not the first, prettiest or most featured. Reviewers chat with it like a real user, read the code, and read DESIGN.md. They want it to answer fast, get things right, and be good to talk to.
- **Technical requirements:**
  - JavaScript or TypeScript on Node;
  - runs with `npm install` then `npm run dev`;
  - every API key it needs listed in `.env.example`;
  - any framework and any model;
  - AI coding tools are welcome, but you must be able to explain every decision.
- **Deliverables:**
  - a public GitHub repository;
  - a one-page DESIGN.md: how it works, why, what was considered and rejected, and what you would do with another week;
  - submission through the application form.
- **Form:**
  - Required: name, email, LinkedIn, in college?, best three projects (a link plus the hardest part of each), GitHub link.
  - Optional: a 1-minute video, and "anything else".
- **Timing:** rolling review in order of arrival, with no due date. A later submission can still win.

## Limits of this verification

- The requirements were transcribed into the spec by Claude from those reads. The raw page text was **not** archived in this handoff.
- **Owner action, recommended:** before submission, re-open both pages, check them against CONTINUUM-SPEC §2, and save a PDF of the Notion page to `docs/brief/` for your own records. Don't commit it to the public repo unless minimi allows that.
- The brief does not say how graders create "Monday" or "3 November" history on a fresh install. Continuum's mitigations are honest empty-memory answers and Timeline Lab. Neither guarantees that the graders' workflow matches.
- The brief does not define "one page", "fast" or "as good as the best agents". Our targets for these are our own (S §2, A §14).
