# Continuum

Continuum is a local chat application for the Minimi engineering challenge. The Phase 1 slice provides Live conversations, streamed turns, cancellation, and SQLite history.

## Run locally

Use Node 24. From the project directory, run:

```powershell
npm install
npm run dev
```

Open <http://127.0.0.1:5173>. The API listens on loopback port 8787 by default. The app creates the database on first boot. The sidebar opens saved conversations, and Stop or Esc cancels the current response.

For local provider qualification, copy `.env.example` to `.env`. Set `GEMINI_API_KEY` with a Google AI Studio key from a project without billing and `TAVILY_API_KEY` with a free-plan key. Run `npm run doctor` and then `npm run doctor -- --full`. The run records attempts before dispatch and writes measured results in [provider qualification](docs/PROVIDER-QUALIFICATION.md). Gemini chat wiring is gated on a passing qualification. The app supports keyless startup and opening history.

For scripted testing, set `CONTINUUM_FAKE_PROVIDERS=1` in the process environment. The app displays a persistent fake-provider banner and uses `continuum-fake.db`.

## Verify

```powershell
npx playwright install chromium
npm run ci
```

The suite includes SQLite and fixture checks, unit and integration tests, a real socket disconnect test, and one Chromium smoke test. See [milestone evidence](docs/PHASE-0-1-MILESTONE.md) for results from this workspace.
