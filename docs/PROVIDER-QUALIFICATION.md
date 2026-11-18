# Provider qualification

**PENDING LIVE QUALIFICATION.** The pinned SDK is installed and both provider hostnames resolve. Both provider settings were previously verified in the gitignored `.env`. After installation, quick and full doctor runs with credentials masked both passed the offline checks. Neither run reserved or dispatched a provider request.

No live observations or models have qualified. Gemini streaming, latency, tool calls, both final-generation variants, structured output and cancellation await a full run. Tavily's basic request and response mapping passed mocked tests and await a live check.

| Provider | Used | Phase 0 remaining |
|---|---:|---:|
| Gemini | 0 | 24 |
| Tavily | 0 | 5 |
| Groq | 0 | 0 |

`CONTINUUM_MODELS` has no qualified order.

Doctor cannot detect billing. Use a Google AI Studio project without billing and a Tavily free-plan key. AI Studio free-tier model limits are pending owner observation. Leave `CONTINUUM_MODELS` empty until a model qualifies.
