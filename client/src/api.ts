// Reads the local chat API and validates event framing across arbitrary network chunks.
import { z } from 'zod';
import { apiErrorSchema, conversationSchema, detailSchema, eventSchema, healthSchema, type TurnEvent } from '../../shared/events.ts';

export async function check(response: Response) {
  if (response.ok) return response;
  const body = apiErrorSchema.safeParse(await response.json().catch(() => null));
  throw new Error(body.success ? body.data.code + ' · ' + body.data.message : 'Request failed (' + response.status + ')');
}

export async function getHealth() {
  return healthSchema.parse(await (await check(await fetch('/api/health'))).json());
}

export async function getConversations() {
  return z.array(conversationSchema).parse(await (await check(await fetch('/api/conversations?workspace=live'))).json());
}

export async function getConversation(id: string) {
  return detailSchema.parse(await (await check(await fetch('/api/conversations/' + encodeURIComponent(id)))).json());
}

export async function newConversation() {
  const response = await check(await fetch('/api/conversations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: 'live' }),
  }));
  return z.object({ id: z.uuid() }).parse(await response.json()).id;
}

export async function streamTurn(id: string, text: string, signal: AbortSignal, onEvent: (event: TurnEvent) => void) {
  const response = await check(await fetch('/api/conversations/' + encodeURIComponent(id) + '/turns', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ text, clientTurnId: crypto.randomUUID(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  }));
  if (!response.body || !response.headers.get('Content-Type')?.startsWith('text/event-stream')) throw new Error('Expected a response stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let seq = 0;
  let turnId: string | undefined;
  let terminal = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const lines = buffer.slice(0, boundary.index).split(/\r?\n/);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        const event = eventSchema.parse(JSON.parse(data));
        if (terminal || event.seq !== ++seq || (turnId && event.turnId !== turnId)) throw new Error('Invalid response sequence.');
        turnId = event.turnId;
        terminal = event.type === 'turn.completed' || event.type === 'turn.error';
        onEvent(event);
      }
    }
    if (!terminal) throw new Error('The response stream closed early. Check the saved conversation.');
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
