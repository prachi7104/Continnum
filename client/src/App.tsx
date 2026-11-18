// Presents saved Live conversations, a streaming transcript and the keyboard-first composer.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import Markdown from 'react-markdown';
import type { ChatMessage } from '../../shared/events.ts';
import { getConversation, getConversations, getHealth, newConversation, streamTurn } from './api.ts';

type Conversation = Awaited<ReturnType<typeof getConversations>>[number];
type Health = Awaited<ReturnType<typeof getHealth>>;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dayFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Continuum could not complete the request.';

function updateUrl(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('conversation', id);
  else url.searchParams.delete('conversation');
  history.replaceState(null, '', url);
}

function statusLabel(message: ChatMessage) {
  if (message.terminalCode === 'INTERRUPTED') return 'Interrupted';
  if (message.terminalCode === 'DEADLINE') return 'Time limit · Partial';
  if (message.status === 'cancelled') return 'Stopped';
  if (message.status === 'partial') return 'Partial';
  if (message.status === 'error') return message.terminalCode ?? 'Error';
  return null;
}

function AssistantText({ content }: { content: string }) {
  return <div className="markdown"><Markdown skipHtml disallowedElements={['img']}
    urlTransform={(value) => /^https?:\/\//i.test(value) ? value : ''}
    components={{ a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>
    {content}
  </Markdown></div>;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saved, setSaved] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [transient, setTransient] = useState<{ question: string; answer: string } | null>(null);
  const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const busy = loading || transient !== null;

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [state, list] = await Promise.all([getHealth(), getConversations()]);
        if (!mounted) return;
        setHealth(state);
        setConversations(list);
        const id = new URLSearchParams(location.search).get('conversation');
        if (id && list.some((item) => item.id === id)) {
          const detail = await getConversation(id);
          if (!mounted) return;
          setSaved(detail.messages);
          setSelected(id);
        } else if (id) {
          updateUrl(null);
        }
      } catch (failure) {
        if (mounted) setError(errorMessage(failure));
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (transient) end.current?.scrollIntoView({ block: 'nearest' });
  }, [transient]);

  async function open(id: string | null) {
    if (busy || controller.current) return;
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const detail = id ? await getConversation(id) : null;
      setSaved(detail?.messages ?? []);
      setSelected(id);
      updateUrl(id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
      composer.current?.focus();
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (busy || controller.current || !question) return;
    const abort = new AbortController();
    controller.current = abort;
    setError('');
    setText('');
    setStatus('Waiting for a response');
    setTransient({ question, answer: '' });
    let id = selected;
    try {
      if (!id) {
        id = await newConversation();
        setSelected(id);
        updateUrl(id);
      }
      await streamTurn(id, question, abort.signal, (event) => {
        if (event.type === 'answer.delta') {
          setStatus('Receiving response');
          setTransient((turn) => turn ? { ...turn, answer: turn.answer + event.text } : turn);
        } else if (event.type === 'turn.error') {
          setError(event.code + ' · ' + event.message);
          setStatus('Turn ended');
        } else if (event.type === 'turn.completed') setStatus('Response saved');
      });
    } catch (failure) {
      if (abort.signal.aborted) setStatus('Response stopped');
      else setError(errorMessage(failure));
    } finally {
      let refreshed: ChatMessage[] | undefined;
      if (id) {
        try {
          let detail = await getConversation(id);
          for (let retry = 0; retry < 10 && detail.messages.at(-1)?.status === 'streaming'; retry++) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
            detail = await getConversation(id);
          }
          refreshed = detail.messages;
          setConversations(await getConversations());
        } catch (failure) {
          setError(errorMessage(failure));
        }
      } else setText(question);
      controller.current = null;
      if (refreshed) setSaved(refreshed);
      setTransient(null);
      composer.current?.focus();
    }
  }

  function handleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && controller.current) {
      event.preventDefault();
      controller.current.abort();
    }
  }

  const active = conversations.find((conversation) => conversation.id === selected);
  return (
    <div className="app" onKeyDown={handleKeys}>
      <aside className="sidebar" aria-label="Live conversations">
        <div className="brand"><span className="mark" aria-hidden="true">C</span><span>Continuum</span></div>
        <button className="new-chat" disabled={busy} onClick={() => void open(null)}><span aria-hidden="true">＋</span> New chat</button>
        <nav className="history" aria-label="Conversation history">
          <h2>Live conversations</h2>
          {conversations.map((item, index) => {
            const day = dayFormat.format(new Date(item.updatedLogicalAt));
            const previous = conversations[index - 1];
            return <div key={item.id}>
              {(!previous || day !== dayFormat.format(new Date(previous.updatedLogicalAt))) && <p className="day">{day}</p>}
              <button disabled={busy} aria-current={selected === item.id ? 'page' : undefined} title={item.title} onClick={() => void open(item.id)}>{item.title}</button>
            </div>;
          })}
        </nav>
      </aside>
      <main className="workspace">
        <header className="topbar"><span className="live"><span aria-hidden="true" />Live</span><span className="thread-title">{active?.title ?? 'New conversation'}</span></header>
        {health?.fakeMode && <p role="status" className="banner fake">FAKE PROVIDERS: responses are scripted test fixtures</p>}
        {health?.providers.model === 'missing_key' && <p role="status" className="banner">Live AI is unavailable. Set <code>GEMINI_API_KEY</code> in the server’s <code>.env</code> and run provider qualification. You can still open saved chats.</p>}
        <div className="transcript">
          {saved.length === 0 && !transient ? (
            <div className="empty"><div className="empty-mark" aria-hidden="true">C</div><h1>Start a conversation</h1><p>Your chats are saved on this device.</p></div>
          ) : (
            <section className="messages" aria-label="Chat messages">
              {saved.map((message) => <article className={'message ' + message.role} key={message.id}>
                <header><strong>{message.role === 'user' ? 'You' : 'Continuum'}</strong><time dateTime={message.logicalAt}>{dateFormat.format(new Date(message.logicalAt))}</time>{message.origin !== 'real' && <span className="badge">{message.origin === 'fake' ? 'Fake' : 'Sample'}</span>}</header>
                {message.content && (message.role === 'assistant' ? <AssistantText content={message.content} /> : <p>{message.content}</p>)}
                {statusLabel(message) && <span className="badge state">{statusLabel(message)}</span>}
              </article>)}
              {transient && <>
                <article className="message user"><header><strong>You</strong></header><p>{transient.question}</p></article>
                <article className="message assistant"><header><strong>Continuum</strong></header><p>{transient.answer || 'Waiting for response…'}</p></article>
              </>}
              <div ref={end} />
            </section>
          )}
        </div>
        <footer className="composer-area">
          <div className="composer-content">
            {error && <p role="alert" className="error">{error}</p>}
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <label className="sr-only" htmlFor="message">Message</label>
              <textarea id="message" ref={composer} value={text} maxLength={8000} rows={2} placeholder="Message Continuum…" onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void submit();
                  }
                }} />
              {transient ? <button type="button" className="send" onClick={() => controller.current?.abort()}>Stop</button> : <button className="send" disabled={loading || !text.trim()}>Send <span aria-hidden="true">↑</span></button>}
            </form>
            <p className="keyboard">Enter to send · Shift+Enter for a new line</p>
            <span role="status" aria-live="polite" className="sr-only">{status}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
