// Reads local server settings without exposing provider keys to the client.
import { resolve } from 'node:path';

function integer(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid numeric setting');
  return value;
}

export function config(env: NodeJS.ProcessEnv) {
  const host = env.HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('HOST must be 127.0.0.1');
  return {
    host, port: integer(env.PORT, 8787, 1, 65535),
    dir: resolve(env.DATA_DIR || './data'),
    deadlineMs: integer(env.TURN_DEADLINE_MS, 30000, 1, 2147483647),
    fakeMode: env.NODE_ENV === 'test' || env.CONTINUUM_FAKE_PROVIDERS === '1',
    labEnabled: env.TIMELINE_LAB !== '0',
    geminiKey: env.GEMINI_API_KEY?.trim() || '',
    geminiModels: [...new Set((env.CONTINUUM_MODELS ?? '').split(',').map((model) => model.trim()).filter(Boolean))],
    tavilyKey: env.TAVILY_API_KEY?.trim() || '',
  };
}
