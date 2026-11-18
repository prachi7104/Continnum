# Continuum Phase 0 and Phase 1 milestone

18 November 2026

| Phase | Status | Outcome |
|---|---|---|
| Phase 0 | **QUALIFICATION PASS** | Frozen fixtures, locked dependencies, SQLite checks, persistent ledger, and both live doctor modes verified. Per-model limits in the owner’s AI Studio dashboard were not observed. |
| Phase 1 | **PASS** | The local chat slice streams real Gemini answers and persists turns. A clean installation, combined dev startup and stock CI with 24 Vitest tests and one Chromium test passed. |

## Repository and environment

- Workspace is `E:\projects\Continuum`.
- Branch is `main`. The fixture freeze is `00a4d3d32d7b5e674e046a382a146ba7ab7cb23f`. The offline baseline is `7f2313f482dec3cb222f3246549bdf26b0cd8922`. Provider qualification and live streaming are committed separately as `e3c8133` and `6068f5f`.
- `origin` is [prachi7104/Continnum](https://github.com/prachi7104/Continnum). GitHub metadata confirmed an empty private repository. No remote write or GitHub Actions run took place.
- The owner-specified workspace and remote supersede the handoff's original location and local-only remote default. The ZIP supplied all seven authoritative v1.1 documents.
- Windows NT 10.0.26300 x64, Node 24.11.0, npm 11.6.1, Git 2.46.2, SQLite 3.50.4. Initial free RAM was 0.73 GiB of 7.73 GiB. Free disk was 43.75 GiB on C: and 69.15 GiB on E:. The Git identity was configured.
- npm failed to resolve `registry.npmjs.org` in the initial managed session. Native PowerShell later resolved all three service hosts, received an npm registry pong in 386 ms, passed the loopback HTTP probe with status 200, and installed the dependencies. All 21 declared exact pins match the lockfile and the installed versions.

## Qualification and budget

The owner confirmed both configured accounts are on free plans. The ignored project-root `.env` is configured with `gemini-3.5-flash-lite,gemini-3.6-flash` after both models qualified. Gemini 3.5 Flash Lite accepted both final variants. Gemini 3.6 Flash accepted explicit tool disabling and timed out when tools were omitted. Full timings and all probe outcomes are in [PROVIDER-QUALIFICATION.md](PROVIDER-QUALIFICATION.md).

| Stage | Provider | Physical attempts or credits used | Remaining |
|---|---|---:|---:|
| Phase 0 | Gemini | 20 | 4 |
| Phase 0 | Tavily | 2 | 3 |
| Phase 0 | Groq | 0 | 0 |
| Phase 1 live verification | Gemini | 2 | 8 |
| Phase 1 live verification | Tavily / Groq | 0 | 0 |

Both doctor modes previously passed with credentials masked. After free-plan confirmation, the quick live smoke passed and the full doctor returned `qualification: PASS`. The cap and cross-process final-slot reservation test passed using throwaway ledgers.

## Verification evidence

- `npm run check-sqlite` passed WAL, foreign keys, composite workspace rejection, FTS5 porter stemming, the negative BM25 score ordering and cascade-to-FTS integrity.
- `npm run check-corpus` passed the frozen IDs and authoring constraints for 20 corpus episodes. The dataset includes 28 resolver cases, 33 retrieval queries, 15 paraphrases and distractors, and 24 live scenarios.
- The Node test fallback with cached Hono 4.13.17, Hono Node server 2.1.6 and Zod 4.6.7 ran 22 tests. Eleven unit and ten in-process integration tests passed. The real HTTP disconnect test failed at the first loopback connection with `EACCES`. Its provider-abort and durable-terminal assertions were unreachable. The in-process cancellation test saved partial text and admitted the next turn.
- Cached Playwright Chromium at 360 px passed the fake banner, Enter-to-send, displayed answer, focus and reload persistence using a buffered route bridge into the actual in-process API. Chrome rejected real loopback with `ERR_NETWORK_ACCESS_DENIED`. The bridge check preceded the Markdown renderer change. The authored Playwright test against Vite and the real SSE transport remains pending.
- A direct keyless Hono startup bound the API port with cached packages. `npm run dev` could not launch because the pinned install failed and `concurrently` was unavailable. `npm run ci` stopped at the unavailable pinned TypeScript executable. The pinned SDK mock, ESLint and Vitest runs and a fresh installation remain unverified. Node 22 was not run.

### Verification with the pinned dependencies

- TypeScript, ESLint, SQLite integrity and the frozen corpus check passed. Vitest passed all 23 tests across four files. The pinned Hono adapter passed the real HTTP disconnect test.
- A clean archive of the committed offline baseline passed `npm ci` and all 23 tests. Vitest needed a path without the managed temporary directory's `#` character.
- After wiring the qualified Gemini adapter, TypeScript and all 24 Vitest tests passed. The new adapter test verified one SDK fetch, two streamed text chunks and no registered tools.
- The first Playwright run reached the app and stopped at browser launch because the pinned Chromium revision was missing.
- With Chromium installed, Playwright exposed overlapping streamed and persisted messages during a sidebar refresh. The UI now switches to the persisted transcript in the same React update that clears the transient turn. The first successful Chromium smoke used an external-server test configuration. The old stock configuration later stalled while terminating the nested `npm run dev` process.
- On Node 24, a clean archive of `6068f5f` installed all 309 locked packages using `npm ci`. The updated Playwright setup launched and stopped Vite and Hono as direct child processes. Stock `npm run ci` exited 0 with 24 Vitest tests and one Chromium test. The browser test used real loopback and checked persistence after reload and the isolated fake database.
- A separate `npm run dev` from the same clean directory started both processes. Chromium opened the UI, and the API reported `missing_key` through the Vite proxy. The snapshot contained no `.env`, and the provider keys were masked in the test processes.

### Live Gemini browser verification

Using Chromium, local Vite and Hono, and an isolated SQLite database, both turns streamed, rendered, and persisted as `COMPLETED`. Each recorded one generation and one Gemini attempt using `gemini-3.5-flash-lite`.

| Route | SSE answer deltas | First progress (ms) | First answer (ms) | Total (ms) | Research prefix |
|---|---:|---:|---:|---:|---|
| `chat_plain` | 2 | 1 | 7406 | 7438 | Absent |
| `research` | 5 | 0 | 1156 | 1265 | Present |

The managed check initially found that Node's dotenv parser could not read the newly inserted model setting. A newline was restored and the parsed values were checked before starting the live run. The failed readiness check issued no provider request.

A second run masked both provider keys. Hono reported `missing_key`, Chromium showed the unavailable-model notice and `NOT_CONFIGURED` for a chat turn, and the isolated database had zero attempt rows.

## Phase 1 acceptance criteria

| # | Status | Evidence or blocker |
|---|---|---|
| 1 | **PASS** | A clean source archive passed `npm ci`. Combined `npm run dev` launched both servers, and Chromium opened the UI through Vite. |
| 2 | **PASS** | Real-loopback browser verification with both keys masked confirmed `missing_key`, the keyless notice, `NOT_CONFIGURED`, and zero provider attempts. |
| 3 | **PASS** | Real Gemini answers streamed through the browser and persisted the selected model, one generation, route and three monotonic timings. The current-information prompt displayed the research prefix. |
| 4 | **PASS** | In-process Stop cancellation and a real HTTP disconnect both aborted the scripted provider, saved partial text, released the lock, and allowed the next turn. |
| 5 | **PASS (offline)** | The file-backed recovery test reopened the database, retained partial content, set `INTERRUPTED`, admitted a new turn and recreated an empty database after removal. |
| 6 | **PASS (in-process)** | Same client turn ID returned `DUPLICATE_TURN` during and after the turn, with one message pair and one attempt. |
| 7 | **PASS (offline)** | Composite FK mismatch rejected. Conversation deletion removed all dependent rows, and FTS integrity checks passed. |
| 8 | **PASS** | Quick and full live doctor runs completed. The full gate passed, with 20/24 Gemini attempts and 2/5 Tavily credits. |
| 9 | **PASS** | Stock `npm run ci` exited 0 on Node 24. TypeScript, ESLint, SQLite, corpus verification, 24 Vitest tests and one real-loopback Playwright test passed. |
| 10 | **PASS** | Fixture files and checker passed. The freeze commit and all five committed-blob SHA-256 hashes are recorded in [DECISIONS.md](DECISIONS.md). Resolver and retrieval implementation has not started. |
| 11 | **PASS** | Native npm generated the v3 lockfile. All 21 exact pins match the manifest, the lockfile and the installed versions. |
| 12 | **PASS (documents)** | `ENVIRONMENT.md`, `DECISIONS.md`, `PROVIDER-QUALIFICATION.md` and `qualification-ledger.json` are present and record the observed state. |

## Remaining work

Phase 1 closed at `f600734ea256603896b0f26bf1e3d769d150e7da`, which records the browser teardown fix and final verification evidence. Node 22 and hosted CI were not run. Per-model limits in the owner's AI Studio dashboard were not observed. Phase 2 implementation and verification are tracked in [PHASE-2-MILESTONE.md](PHASE-2-MILESTONE.md).

## Environment recovery attempt

These historical observations predate the native installation, loopback verification, and local Git closeout. The pinned verification results above supersede the earlier cached checks and browser bridge. Managed Git writes still require native execution.

| Check | Recovery result |
|---|---|
| Registry DNS and connectivity | **BLOCKED**. `registry.npmjs.org` returned `ENOTFOUND`. The explicit npm registry ping failed on the same lookup. |
| Provider DNS | **BLOCKED**. `generativelanguage.googleapis.com` and `api.tavily.com` both returned `ENOTFOUND`. |
| Managed Git writes | **BLOCKED**. Explicit fixture staging failed to create `.git/index.lock`. The managed approval policy rejected the staging escalation because sandbox approvals are disabled. Native Git subsequently created the fixture commit. |
| Loopback transport | **BLOCKED**. Node bound a temporary HTTP server to 127.0.0.1 and received `EACCES` on its client connection. The server closed at the end of the probe. |
| Disk and memory | **MEASURED**. 39.60 GiB free on C:, 69.08 GiB free on E:, and 0.68 GiB of 7.73 GiB RAM free at inspection. Memory remains relevant to Chromium. |
| Native Windows comparison | **PASS**. DNS succeeded for npm, Gemini, and Tavily. npm registry ping returned PONG in 386 ms, loopback returned HTTP 200, and native Git writes succeeded. Free RAM was 0.77 GiB, with 38.77 GiB free on C: and 69.07 GiB on E:. |
| Fixture freeze | **PASS**. The root commit and all five committed SHA-256 hashes are recorded in [DECISIONS.md](DECISIONS.md). The resolver and retrieval implementation are absent. |
| Exact installation | **PASS**. Native npm installed the dependencies and generated `package-lock.json`. All 21 exact direct pins match the installed versions. |
| Qualification | **PASS**. Quick and full live probes completed after free-plan confirmation. |
| Pinned checks and fresh installation | The clean live baseline passed `npm ci` and combined dev startup. With the direct-child browser setup, stock CI exited 0. |

The Git ignore rules cover credential environment files, SQLite databases and sidecars, logs, browser sessions and authentication states, temporary test data, provider transcripts and installed packages. Eleven `git check-ignore` probes passed, and `.env.example` remains eligible for staging.

### Approved dependency manifest

| Runtime | Dev and checks |
|---|---|
| `@ai-sdk/google@4.0.121` | `@playwright/test@1.65.1` |
| `@hono/node-server@2.1.9` | `@types/node@24.10.0` |
| `ai@7.0.173` | `@types/react@19.2.2` |
| `hono@4.13.19` | `@types/react-dom@19.2.2` |
| `react@19.3.1` | `@vitejs/plugin-react@6.3.0` |
| `react-dom@19.3.1` | `concurrently@10.0.7` |
| `zod@4.6.7` | `eslint@10.15.0` |
| `chrono-node@2.10.3` | `tsx@4.23.15` |
| `react-markdown@10.1.0` | `typescript@5.9.3` |
| | `typescript-eslint@8.73.0` |
| | `vite@8.3.8` |
| | `vitest@5.1.0` |

### Provider qualification during recovery

| Provider or candidate | Gate | Observation |
|---|---|---|
| `gemini-3.8-flash` | **NOT QUALIFIED** | Structured output timed out. |
| `gemini-3.6-flash` | **PASS** | Qualified with `toolChoice: 'none'`. |
| `gemini-3.5-flash-lite` | **PASS** | Qualified with both final variants and the lowest first-text latency in the full run. |
| Tavily basic search | **PASS** | Quick and full live result checks passed. |

Live chat tries `gemini-3.5-flash-lite` first, then `gemini-3.6-flash`.

## Native PowerShell commands

The comparison checks, fixture commit and dependency installation were completed from native Windows PowerShell on 18 November 2026. The commands are retained for reproducibility.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
node -e "const os=require('node:os'); console.log('Free RAM GiB: '+(os.freemem()/2**30).toFixed(2));"
Get-PSDrive C,E | Select-Object Name,Free
foreach ($fqdn in 'registry.npmjs.org','generativelanguage.googleapis.com','api.tavily.com') {
    try {
        Resolve-DnsName -Name $fqdn -ErrorAction Stop | Out-Null
        Write-Output "$fqdn DNS OK"
    } catch {
        Write-Output "$fqdn DNS failed: $($_.Exception.Message)"
    }
}
npm.cmd ping --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=8000
node -e "const h=require('node:http'); const s=h.createServer((r,w)=>w.end('ok')); s.on('error',e=>{console.error(e.code);process.exitCode=1}); s.listen(0,'127.0.0.1',()=>{const q=h.get({host:'127.0.0.1',port:s.address().port,path:'/'},r=>{console.log('Loopback HTTP '+r.statusCode);r.resume();s.close()});q.on('error',e=>{console.error(e.code);process.exitCode=1;s.close()});q.setTimeout(5000,()=>q.destroy(new Error('loopback timeout')))});"
```

The Git block is independent of DNS. It stages only the ignore rules, public environment template, fixtures and fixture checker. Stop and inspect if it reports an index lock, a changed HEAD, or unexpected staged files.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
git status --short --branch
$branch = git symbolic-ref --short HEAD
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Expected branch main.' }
git rev-parse --verify --quiet HEAD | Out-Null
if ($LASTEXITCODE -eq 0) { throw 'HEAD already exists. Inspect it before proceeding.' }
if (Test-Path -LiteralPath '.git\index.lock') { throw 'Existing index.lock. Inspect Git processes before proceeding.' }
$fixturePaths = @('eval/fixtures/corpus.json', 'eval/fixtures/live-scenarios.json', 'eval/fixtures/resolver-cases.json', 'eval/fixtures/retrieval-queries.json', 'scripts/check-corpus.ts')
$paths = @('.gitignore', '.env.example') + $fixturePaths
$unexpected = @(git diff --cached --name-only | Where-Object { $_ -notin $paths })
if ($LASTEXITCODE -ne 0 -or $unexpected.Count) { throw 'Inspect unexpected staged paths.' }
git add -- $paths
if ($LASTEXITCODE -ne 0) { throw 'Git staging failed.' }
$staged = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0 -or (Compare-Object $paths $staged)) { throw 'Inspect unexpected staged paths.' }
git commit -m 'chore: freeze Continuum evaluation fixtures'
if ($LASTEXITCODE -ne 0) { throw 'Fixture commit failed.' }
$freezeSha = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Could not read fixture commit SHA.' }
$evidence = @'
import hashlib
import subprocess
import sys
commit, *paths = sys.argv[1:]
print()
print("### Committed fixture freeze")
print()
print(f"Local commit: `{commit}`")
print()
print("| File | Committed blob SHA-256 |")
print("|---|---|")
for path in paths:
    blob = subprocess.check_output(["git", "cat-file", "blob", f"{commit}:{path}"])
    print(f"| `{path}` | `{hashlib.sha256(blob).hexdigest()}` |")
'@ | python - $freezeSha $fixturePaths
if ($LASTEXITCODE -ne 0) { throw 'Could not hash the committed fixtures.' }
$evidence | Add-Content -Encoding UTF8 -LiteralPath 'docs\DECISIONS.md'
Write-Output $evidence
```

After npm registry access is confirmed, check the declared releases and install from the approved manifest. This block stops on an unavailable pin and leaves dependency changes for review.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
$manifest = Get-Content package.json -Raw | ConvertFrom-Json
foreach ($group in $manifest.dependencies, $manifest.devDependencies) {
    foreach ($entry in $group.PSObject.Properties) {
        $spec = "$($entry.Name)@$($entry.Value)"
        $reported = npm.cmd view $spec version --json --registry=https://registry.npmjs.org --fetch-retries=0 --fetch-timeout=8000
        if ($LASTEXITCODE -ne 0 -or ($reported | ConvertFrom-Json) -ne $entry.Value) { throw "Could not verify $spec." }
        Write-Output "$spec available"
    }
}
npm.cmd install --no-audit --no-fund
if ($LASTEXITCODE -ne 0 -or !(Test-Path -LiteralPath 'package-lock.json')) { throw 'Pinned install or lockfile generation failed.' }
npm.cmd ls --depth=0
if ($LASTEXITCODE -ne 0) { throw 'The installed dependency tree did not match the manifest.' }
& '.\node_modules\.bin\playwright.cmd' install chromium
if ($LASTEXITCODE -ne 0) { throw 'Chromium install failed.' }
npm.cmd run ci
if ($LASTEXITCODE -ne 0) { throw 'Pinned verification failed.' }
```

After recording the offline baseline commit below, confirm that the existing keys are from free projects and provider DNS is working, then read the ledger totals and run the quick doctor. Run the full doctor if the quick results justify proceeding within the existing budget. Phase 1 production wiring requires a passing Gemini model. Offline CI and the loopback check use no provider requests.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
$ledger = Get-Content 'docs\qualification-ledger.json' -Raw | ConvertFrom-Json
foreach ($provider in 'gemini','tavily','groq') {
    Write-Output "$provider $($ledger.$provider.used)/$($ledger.$provider.cap)"
}
npm.cmd run doctor
```

Once the quick result and remaining budget have been checked, run `npm.cmd run doctor -- --full` for the measured gate.

Once the implementation and locked results are ready to record, stage the explicit project paths. Review the printed staged list before running the commit command.

```powershell
Set-Location -LiteralPath 'E:\projects\Continuum'
if (!(Test-Path -LiteralPath 'package-lock.json')) { throw 'The approved lockfile is required for the implementation commit.' }
git add -- .gitignore .env.example .github .nvmrc README.md client docs e2e eslint.config.js eval/budget.md package.json package-lock.json playwright.config.ts scripts server shared tests tsconfig.json vite.config.ts vitest.config.ts
if ($LASTEXITCODE -ne 0) { throw 'Implementation staging failed.' }
git diff --cached --name-only
git diff --cached --check
# After reviewing the staged paths:
git commit -m 'feat: establish offline Continuum baseline'
git log -2 --format='%h %s'
```

Create a fresh local checkout without copying the working-tree `.env` or SQLite data. This command leaves the original workspace and its data in place.

```powershell
$fresh = Join-Path ([System.IO.Path]::GetTempPath()) ('continuum-fresh-' + [guid]::NewGuid().ToString('N'))
git clone --local -- 'E:\projects\Continuum' $fresh
if ($LASTEXITCODE -ne 0) { throw 'Fresh local clone failed.' }
Set-Location -LiteralPath $fresh
if (Test-Path -LiteralPath '.env') { throw 'Unexpected .env in the clean checkout.' }
npm.cmd ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Clean locked installation failed.' }
npm.cmd run ci
if ($LASTEXITCODE -ne 0) { throw 'Fresh-checkout verification failed.' }
$env:GEMINI_API_KEY = ' '
$env:TAVILY_API_KEY = ' '
$env:CONTINUUM_FAKE_PROVIDERS = '0'
$env:NODE_ENV = 'development'
npm.cmd run dev
```

While that server is running, open [the application](http://127.0.0.1:5173) and run `Invoke-RestMethod -Uri 'http://127.0.0.1:5173/api/health'` in a second PowerShell window. Confirm the UI, keyless banner and missing-key health, then stop the dev process with Ctrl+C.
