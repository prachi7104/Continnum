// Runs keyless checks or the capped quick and full qualification plans.
import { mkdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wallClock } from '../server/src/clock.ts';
import { ModelFailure } from '../server/src/llm/provider.ts';
import { SearchFailure } from '../server/src/search/provider.ts';
import { reserve, readLedger, recordOutcome } from './budget-ledger.ts';

const full = process.argv.includes('--full');
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const tavilyKey = process.env.TAVILY_API_KEY?.trim();
const missing = [!geminiKey && 'GEMINI_API_KEY', !tavilyKey && 'TAVILY_API_KEY'].filter(Boolean);
const billing = 'Doctor cannot detect billing. Use a Google AI Studio project without billing and a Tavily free-plan key.';
const reportPath = fileURLToPath(new URL('../docs/PROVIDER-QUALIFICATION.md', import.meta.url));
const lockPath = reportPath + '.lock';
type ProbeRow = { model: string; check: string; outcome: string; firstMs?: number; totalMs?: number };

async function attempt<T>(kind: 'gemini' | 'tavily', model: string | null, purpose: string,
  operation: (signal: AbortSignal) => Promise<T>, rows: ProbeRow[]): Promise<T | undefined> {
  const id = reserve(kind, model, purpose);
  const signal = AbortSignal.timeout(30000);
  let outcome = 'pass';
  let value: T | undefined;
  try {
    value = await operation(signal);
  } catch (error) {
    const failure = error instanceof ModelFailure || error instanceof SearchFailure ? error : null;
    outcome = signal.aborted ? 'timeout' : failure?.status ? 'http_' + failure.status
      : failure instanceof ModelFailure ? failure.kind : 'failed';
  }
  recordOutcome(id, outcome);
  const timing = value && typeof value === 'object' && 'firstMs' in value && 'totalMs' in value
    ? { firstMs: Number(value.firstMs), totalMs: Number(value.totalMs) } : {};
  rows.push({ model: model ?? kind, check: purpose, outcome, ...timing });
  return value;
}

function writeReport(rows: ProbeRow[], order: string[], gate: string) {
  const ledger = readLedger();
  const table = rows.map((row) => '| ' + [row.model, row.check, row.outcome, row.firstMs ?? '—', row.totalMs ?? '—'].join(' | ') + ' |');
  const report = [
    '# Provider qualification', '', '**' + gate + '**', '', 'Run recorded ' + wallClock.nowIso() + '.', '',
    '| Provider or model | Check | Outcome | First text (ms) | Total (ms) |', '|---|---|---|---:|---:|', ...table, '',
    'CONTINUUM_MODELS=' + order.join(','),
    'Models must pass every required check. Models accepting both final variants rank first, then lower measured first-text latency.', '',
    'Cumulative reservations: Gemini ' + ledger.gemini.used + '/24, Tavily ' + ledger.tavily.used + '/5, Groq 0/0.', '',
    billing, 'AI Studio free-tier model limits await owner verification.', '',
  ].join('\n');
  writeFileSync(reportPath + '.tmp', report);
  renameSync(reportPath + '.tmp', reportPath);
}

async function main() {
  await import('./check-sqlite.ts');
  await import('./check-corpus.ts');
  console.log(billing);
  const rows: ProbeRow[] = [];
  const qualified: { model: string; finalVariants: number; firstMs: number }[] = [];
  if (geminiKey) {
    const { candidates, oneGoogleRequest } = await import('../server/src/llm/gemini.ts');
    const probes = await import('./qualification-probes.ts');
    for (const id of candidates) {
      const invoke = <T>(purpose: string, operation: (model: ReturnType<typeof oneGoogleRequest>, signal: AbortSignal) => Promise<T>) =>
        attempt('gemini', id, purpose, (signal) => operation(oneGoogleRequest(geminiKey, id), signal), rows);
      const timing = await invoke(full ? 'stream' : 'quick-stream', probes.plain);
      if (!full || !timing) continue;
      const history = await invoke('parallel-tools', probes.toolHistory);
      if (!history) continue;
      let variants = 0;
      for (const variant of ['none', 'omitted'] as const) {
        const result = await invoke('final-' + variant, async (model, signal) => {
          await probes.finalGeneration(model, signal, history, variant);
          return true;
        });
        if (result) variants++;
      }
      if (!variants) continue;
      const structured = await invoke('output-array', async (model, signal) => {
        await probes.outputArray(model, signal);
        return true;
      });
      if (!structured) continue;
      const cancel = await invoke('cancellation', async (model, signal) => {
        await probes.cancellation(model, signal);
        return true;
      });
      if (cancel) qualified.push({ model: id, finalVariants: variants, firstMs: timing.firstMs });
    }
  }
  if (tavilyKey) {
    const { tavily } = await import('../server/src/search/tavily.ts');
    await attempt('tavily', null, full ? 'basic-result-shape' : 'quick-basic', async (signal) => {
      const results = await tavily(tavilyKey, wallClock).search('Node.js official documentation', signal);
      if (!results.length) throw new SearchFailure();
      return results.length;
    }, rows);
  }
  const order = qualified.sort((a, b) => b.finalVariants - a.finalVariants || a.firstMs - b.firstMs).map((candidate) => candidate.model);
  const gate = order.length ? 'qualification: PASS' : full && geminiKey
    ? 'qualification: FAIL (no passing model)' : missing.length
    ? 'qualification: BLOCKED (missing ' + missing.join(' / ') + ')'
    : 'qualification: PENDING (quick checks only)';
  console.table(rows);
  console.log(gate);
  if (geminiKey && !tavilyKey) console.log('Tavily: BLOCKED (missing TAVILY_API_KEY).');
  const ledger = readLedger();
  console.log('Cumulative reservations: Gemini ' + ledger.gemini.used + '/24, Tavily ' + ledger.tavily.used + '/5, Groq 0/0.');
  if (full && (geminiKey || tavilyKey)) writeReport(rows, order, gate);
}

try {
  mkdirSync(lockPath);
} catch {
  console.error('Doctor could not acquire its exclusive local run lock.');
  process.exit(1);
}
try {
  await main();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
    console.error('Doctor stopped before qualification could complete. Install the pinned dependencies with npm install.');
  } else {
    console.error('Doctor stopped. Check the offline checks and qualification ledger before rerunning.');
  }
  process.exitCode = 1;
} finally {
  rmdirSync(lockPath);
}
