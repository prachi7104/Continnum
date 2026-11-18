// Launches the real dev servers as direct children for reliable Windows teardown.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const web = 'http://127.0.0.1:5173/';
const api = 'http://127.0.0.1:18787/api/health';

async function probe(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return undefined;
  }
}

async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}

export default async function setup() {
  if (await probe(web) !== undefined || await probe(api) !== undefined) {
    throw new Error('Continuum browser test ports 5173 and 18787 must be free.');
  }
  const dataDir = process.env.CONTINUUM_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'continuum-e2e-'));
  process.env.CONTINUUM_E2E_DATA_DIR = dataDir;
  const env = {
    ...process.env,
    CONTINUUM_FAKE_PROVIDERS: '1',
    GEMINI_API_KEY: ' ',
    TAVILY_API_KEY: ' ',
    DATA_DIR: dataDir,
    PORT: '18787',
    HOST: '127.0.0.1',
  };
  const commands = [
    ['--no-warnings', '--env-file-if-exists=.env', '--import', 'tsx', '--import', './scripts/sqlite-warnings.ts', 'server/src/index.ts'],
    ['node_modules/vite/bin/vite.js'],
  ];
  const errors: Error[] = [];
  const children = commands.map((args) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('error', (error) => errors.push(error));
    return child;
  });
  const shutdown = async () => { await Promise.all(children.map(stop)); };
  try {
    const timeout = AbortSignal.timeout(45000);
    for (;;) {
      if (errors.length || children.some((child) => child.exitCode !== null || child.signalCode !== null)) {
        throw errors[0] ?? new Error('A Continuum browser test server exited during startup.');
      }
      const [webStatus, apiStatus] = await Promise.all([probe(web), probe(api)]);
      if (webStatus === 200 && apiStatus === 200) return shutdown;
      await sleep(200, undefined, { signal: timeout });
    }
  } catch (error) {
    await shutdown();
    throw error;
  }
}
