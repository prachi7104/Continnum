// Boots the local Hono server and its isolated SQLite store.
import { serve } from '@hono/node-server';
import { LogicalClock, monotonic, wallClock } from './clock.ts';
import { config } from './config.ts';
import { createApp } from './api/routes.ts';
import { Repo } from './db/repo.ts';
import { fakeModel } from './llm/fake.ts';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 && !(major === 22 && minor >= 13)) {
  console.error('Continuum requires Node ^22.13.0 or ^24.0.0.');
  process.exit(1);
}

const settings = config(process.env);
const model = settings.fakeMode ? fakeModel : null;
const repo = new Repo(settings.dir, settings.fakeMode, wallClock);
const app = createApp({
  repo, model, wall: wallClock, logical: new LogicalClock(repo, wallClock), monotonic,
  deadlineMs: settings.deadlineMs, fakeMode: settings.fakeMode, labEnabled: settings.labEnabled,
  hasGeminiKey: Boolean(settings.geminiKey), hasTavilyKey: Boolean(settings.tavilyKey),
});
const server = serve({ fetch: app.fetch, hostname: settings.host, port: settings.port }, (info) => {
  console.log('Continuum API listening at http://' + settings.host + ':' + info.port);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => repo.close()));
}
