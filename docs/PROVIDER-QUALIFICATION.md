# Provider qualification

**qualification: PASS**

Run recorded 2026-11-18T06:39:24.445Z.

| Provider or model | Check | Outcome | First text (ms) | Total (ms) |
|---|---|---|---:|---:|
| gemini-3.8-flash | stream | pass | 11424 | 11436 |
| gemini-3.8-flash | parallel-tools | pass | — | — |
| gemini-3.8-flash | final-none | pass | — | — |
| gemini-3.8-flash | final-omitted | pass | — | — |
| gemini-3.8-flash | output-array | timeout | — | — |
| gemini-3.6-flash | stream | pass | 16160 | 16165 |
| gemini-3.6-flash | parallel-tools | pass | — | — |
| gemini-3.6-flash | final-none | pass | — | — |
| gemini-3.6-flash | final-omitted | timeout | — | — |
| gemini-3.6-flash | output-array | pass | — | — |
| gemini-3.6-flash | cancellation | pass | — | — |
| gemini-3.5-flash-lite | stream | pass | 6035 | 6045 |
| gemini-3.5-flash-lite | parallel-tools | pass | — | — |
| gemini-3.5-flash-lite | final-none | pass | — | — |
| gemini-3.5-flash-lite | final-omitted | pass | — | — |
| gemini-3.5-flash-lite | output-array | pass | — | — |
| gemini-3.5-flash-lite | cancellation | pass | — | — |
| tavily | basic-result-shape | pass | — | — |

CONTINUUM_MODELS=gemini-3.5-flash-lite,gemini-3.6-flash
Models must pass every required check. Models accepting both final variants rank first, then lower measured first-text latency.

Cumulative reservations: Gemini 20/24, Tavily 2/5, Groq 0/0.

Doctor cannot detect billing. Use a Google AI Studio project without billing and a Tavily free-plan key.
The owner confirmed both configured accounts are on free plans. The per-model AI Studio rate limits were not observed.

### Quick smoke

| Provider or model | First text (ms) | Total (ms) |
|---|---:|---:|
| gemini-3.8-flash | 19716 | 19728 |
| gemini-3.6-flash | 20115 | 20120 |
| gemini-3.5-flash-lite | 11071 | 11080 |

Tavily's quick basic search passed. The cumulative counts include both runs.

Gemini 3.5 Flash Lite qualified with both final variants and the quickest full streaming probe. Gemini 3.6 Flash qualified with `toolChoice: 'none'`. Its omitted-tools probe timed out. Gemini 3.8 Flash timed out on structured array output, so its cancellation probe was skipped and it did not qualify.
