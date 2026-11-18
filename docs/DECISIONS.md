# Phase 0 and 1 decisions

- Use the owner-specified `E:\projects\Continuum` workspace and record the existing GitHub repository as `origin`. Those two instructions supersede the corresponding v1.1 defaults. Git work is local.
- Phase 1 accepts the complete schema and keeps Lab HTTP controls, research and retrieval for their scheduled phases.
- Reviewed the [AI SDK streamText contract](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), [structured output](https://ai-sdk.dev/docs/reference/ai-sdk-core/output), [test doubles](https://ai-sdk.dev/docs/ai-sdk-core/testing), [Google adapter](https://ai-sdk.dev/providers/ai-sdk-providers/google) and [Tavily REST search](https://docs.tavily.com/documentation/api-reference/endpoint/search).
- Tavily documents `chunks_per_source` for basic, fast and advanced search. Keep the approved basic request. The response can supply a null publication date.
- The sandbox denied writing `.git/index.lock`, so the fixture freeze exists on disk with no commit hash. Resolver and retrieval work must wait for that commit.
- Cached Hono 4.13.17 and the Hono Node server 2.1.6 were used for offline behavior checks. The package manifest keeps the approved 4.13.19 and 2.1.9 pins. The cached checks do not qualify the exact dependency set.
- Fallback stops as soon as a provider emits answer text. A later provider error preserves the partial answer and ends the turn with a typed error.
- Recovery on 18 November 2026 reproduced the Git index write denial. There is still no fixture commit SHA. The entries below are SHA-256 hashes of the existing working-tree bytes, taken before any temporal resolver or retrieval implementation. When native staging succeeds, add the actual freeze commit SHA and hash the committed blobs, which may use normalized line endings.

| Frozen file | Working-tree SHA-256 |
|---|---|
| `eval/fixtures/corpus.json` | `db326784f59cbbff7393742edb4f088da9ca03c32e5e0cb61a90a45cfdebf816` |
| `eval/fixtures/live-scenarios.json` | `7cc2238051eef0da1a6b9c1ef33c8666d2281c982549044cfad464dfafff718e` |
| `eval/fixtures/resolver-cases.json` | `7dfaad0186822b01f26119fb0f1c9ed358be5e40f9c36722cc85c2ec9893e6145a6` |
| `eval/fixtures/retrieval-queries.json` | `877564c8e73dad86ac7276ea776b859fe43e1b12be4f85f590d3f38b70dad720` |
| `scripts/check-corpus.ts` | `32b11e40c4f3ecea40ba7e99d1c3764631100844ffb9748a7e6fd3c374fc5bf8` |

### Incremental commits

Keep the fixture freeze as the first commit. Commit the locked offline baseline, provider qualification evidence, and live integration with its verification at separate checkpoints. Native PowerShell is available for Git writes. A GitHub push publishes all commits since the previous push.

### Committed fixture freeze

Local commit: `00a4d3d32d7b5e674e046a382a146ba7ab7cb23f`

| File | Committed blob SHA-256 |
|---|---|
| `eval/fixtures/corpus.json` | `db326784f59cbbff7393742edb4f088da9ca03c32e5e0cb61a90a45cfdebf816` |
| `eval/fixtures/live-scenarios.json` | `7cc2238051eef0da1a6b9c1ef33c8666d2281c982549044cfad464dfafff718e` |
| `eval/fixtures/resolver-cases.json` | `7dfaadc032b01f26119fb0f1c9ed358be5e40f9c36722cc85c2ec9893e6145a6` |
| `eval/fixtures/retrieval-queries.json` | `877564c8e73dad86ac7276ea776b859fe43e1b12be4f85f590d3f38b70dad720` |
| `scripts/check-corpus.ts` | `32b11e40c4f3ecea40ba7e99d1c3764631100844ffb9748a7e6fd3c374fc5bf8` |
