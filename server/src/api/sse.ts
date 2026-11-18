// Sends validated, monotonically sequenced events while the connection is open.
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { eventSchema, type TurnEventBody } from '../../../shared/events.ts';

export function turnStream(c: Context, turnId: string,
  run: (signal: AbortSignal, send: (body: TurnEventBody) => Promise<void>) => Promise<void>) {
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const disconnected = new AbortController();
    stream.onAbort(() => disconnected.abort());
    const requestSignal = c.req.raw.signal;
    const signal = AbortSignal.any([requestSignal, disconnected.signal]);
    const closeOnRequestAbort = () => stream.abort();
    requestSignal.addEventListener('abort', closeOnRequestAbort, { once: true });
    if (requestSignal.aborted) stream.abort();
    let seq = 0;
    try {
      await run(signal, async (body) => {
        if (signal.aborted || stream.closed || stream.aborted) return;
        const event = eventSchema.parse({ ...body, turnId, seq: ++seq });
        await stream.writeSSE({ event: event.type, id: String(event.seq), data: JSON.stringify(event) });
      });
    } catch {
      console.error('Continuum turn stream could not be finalized:', turnId);
    } finally {
      requestSignal.removeEventListener('abort', closeOnRequestAbort);
    }
  });
}
