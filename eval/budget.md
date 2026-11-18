# Live usage

| Stage | Gemini attempts | Tavily credits | Groq attempts |
|---|---:|---:|---:|
| Phase 0 | 20 / 24 | 2 / 5 | 0 / 0 |
| Phase 1 verification | 2 / 10 | 0 / 0 | 0 / 0 |
| Phase 2 development | 0 | 0 | 0 |
| Phase 2 one-shot live smoke | 2 / 2 | 1 / 1 | 0 / 0 |
| Phase 2 separately authorized retest | 0 / 2 | 0 / 1 | 0 / 0 |

Phase 0 used the qualification ledger. Phase 1 counts come from persisted attempt rows in the isolated live browser verification database.

The original Phase 2 allocation is exhausted. The Flash Lite turn used one search round, with zero retries and zero fallback attempts. All three HTTP requests returned 200. The application completed the turn with an evidence limitation and the smoke failed its sourced-answer checks. The original ignored receipts remain in `tmp/phase2-live-smoke/`. The investigation used offline mocks.

The separately authorized retest is pending stock offline CI and the local Phase 2 commit. It has its own one-shot reservation at `tmp/phase2-live-smoke-02/`, with one query, one round, zero retries and zero fallback attempts.
