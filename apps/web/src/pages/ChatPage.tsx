import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Send, Sparkles, Square, ThumbsDown, ThumbsUp } from 'lucide-react';
import { SUGGESTED_QUESTIONS, type AnswerBlock, type ChatResponse } from '@lbrce/shared';
import { api, ensureBrowserSession, streamChat } from '../api/client';
import { AnswerBlocks } from '../components/AnswerBlocks';
import { getSessionId } from '../lib/session';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: AnswerBlock[];
  pending?: boolean;
}

export function ChatPage({
  conversationId,
  onConversation,
  initialDraft = '',
}: {
  conversationId?: string;
  onConversation: (id: string) => void;
  initialDraft?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [related, setRelated] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [streaming, setStreaming] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const busy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    void ensureBrowserSession(getSessionId())
      .then(() =>
        api<{ messages: { id: string; role: 'user' | 'assistant'; content: string; blocks: AnswerBlock[] }[] }>(
          `/api/chat/${conversationId}`,
        ),
      )
      .then((result) => {
        setError('');
        setMessages(result.messages);
      })
      .catch(() => {
        setMessages((current) => {
          if (current.length === 0) setError('This conversation could not be loaded.');
          return current;
        });
      });
  }, [conversationId]);

  useEffect(() => {
    const node = scroller.current;
    if (!node || !stickToBottom.current) return;
    node.scrollTo?.({ top: node.scrollHeight });
  }, [messages, streaming, status]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message || busy.current) return;
    busy.current = true;
    setDraft('');
    setRelated([]);
    setError('');
    setStreaming('');
    setStatus('Thinking');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: message }]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await ensureBrowserSession(getSessionId());
      await streamChat(
        { message, sessionId: getSessionId(), conversationId },
        {
          onStatus: () => setStatus('Thinking'),
          onToken: (token) => setStreaming((current) => current + token),
          onDone: (response) => {
            setStreaming('');
            setStatus('');
            onConversation(response.conversationId);
            setRelated([]);
            setMessages((current) => [...current, assistantFrom(response)]);
          },
        },
        controller.signal,
      );
    } catch (caught) {
      setStatus('');
      setStreaming('');
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setError('Generation stopped.');
      } else {
        setError(caught instanceof Error ? caught.message : 'The request failed.');
      }
    } finally {
      abortRef.current = null;
      busy.current = false;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const thinking = Boolean(status);
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-white pt-16 lg:pt-0">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        onScroll={() => {
          const node = scroller.current;
          if (!node) return;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.length === 0 ? <Welcome onPick={(question) => void submit(question)} /> : null}
          {messages.map((message) => (
              <article key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={message.role === 'user' ? 'max-w-[85%]' : 'min-w-0 flex-1'}>
                  {message.role === 'user' ? (
                    <p className="whitespace-pre-wrap rounded-3xl bg-[#f4f4f4] px-4 py-2.5 text-[15px] leading-7">{message.content}</p>
                  ) : message.blocks ? (
                    <AnswerBlocks blocks={message.blocks} showSources onChoose={thinking ? undefined : (option) => void submit(option)} />
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
                  )}
                  {message.role === 'assistant' ? (
                    <div className="no-print mt-1 flex gap-1 text-muted opacity-0 transition hover:opacity-100 focus-within:opacity-100">
                      <IconButton label="Copy answer" onClick={() => void navigator.clipboard?.writeText(message.content)}>
                        <Copy size={15} />
                      </IconButton>
                      <IconButton label="Helpful" onClick={() => void feedback(message.id, conversationId, 'up')}>
                        <ThumbsUp size={15} />
                      </IconButton>
                      <IconButton label="Not helpful" onClick={() => void feedback(message.id, conversationId, 'down')}>
                        <ThumbsDown size={15} />
                      </IconButton>
                    </div>
                  ) : null}
                </div>
              </article>
          ))}
          {thinking || streaming ? <Reasoning text={streaming} /> : null}
          {related.length ? (
            <div className="flex flex-wrap gap-2">
              {related.map((question) => (
                <button key={question} type="button" className="rounded-full border border-line px-3 py-1.5 text-left text-sm hover:bg-canvas" onClick={() => void submit(question)}>
                  {question}
                </button>
              ))}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p>{error}</p>
              <button type="button" className="mt-2 font-semibold" onClick={() => void submit(messages.filter((item) => item.role === 'user').at(-1)?.content ?? '')}>
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <form
        className="no-print shrink-0 bg-white px-4 pb-4 pt-2 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[28px] border border-line bg-white px-2 py-2 shadow-card focus-within:border-ink/30">
          <textarea
            aria-label="Message"
            value={draft}
            rows={1}
            placeholder="Message LBRCE AI"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 outline-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit(draft);
              }
            }}
          />
          {thinking ? (
            <button type="button" aria-label="Stop" className="mb-1 inline-flex h-11 items-center gap-2 rounded-2xl bg-ink px-4 font-semibold text-white" onClick={stop}>
              <Square size={14} />
              Stop
            </button>
          ) : (
            <button type="submit" aria-label="Send" className="mb-1 inline-flex h-11 items-center gap-2 rounded-2xl bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-brand/40" disabled={!draft.trim()}>
              <Send size={16} />
              Send
            </button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-muted">Enter to send. Shift+Enter for a new line.</p>
      </form>
    </section>
  );
}

function Reasoning({ text }: { text: string }) {
  return (
    <article aria-live="polite">
      {text ? (
        <p className="whitespace-pre-wrap text-[15px] leading-7 text-ink">
          {text}
          <span className="think-caret" aria-hidden="true" />
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="think-dot" aria-hidden="true" />
          Thinking
        </p>
      )}
    </article>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} className="rounded-lg p-1.5 hover:bg-canvas hover:text-brand" onClick={onClick}>
      {children}
    </button>
  );
}

function Welcome({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl pt-8 sm:pt-16">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-white shadow-card">
          <Sparkles size={22} />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Lakireddy Bali Reddy College of Engineering</p>
          <h2 className="text-3xl font-semibold tracking-tight">Ask about LBRCE</h2>
        </div>
      </div>
      <p className="max-w-xl text-muted">
        Ask any question about the college. Factual claims stay tied to official LBRCE records, pages, and documents, and a follow-up uses this conversation.
      </p>
      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        {SUGGESTED_QUESTIONS.slice(0, 6).map((question) => (
          <button key={question} type="button" className="rounded-2xl border border-line bg-white px-4 py-3 text-left text-sm shadow-card transition hover:-translate-y-0.5 hover:border-brand" onClick={() => onPick(question)}>
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

function assistantFrom(response: ChatResponse): ChatMessage {
  return {
    id: response.messageId,
    role: 'assistant',
    content: response.blocks
      .map((block) => ('markdown' in block ? block.markdown : 'message' in block ? block.message : 'question' in block ? block.question : ''))
      .join('\n'),
    blocks: response.blocks,
  };
}

function feedback(messageId: string, conversationId: string | undefined, rating: 'up' | 'down') {
  if (!conversationId) return;
  return api('/api/feedback', { method: 'POST', body: JSON.stringify({ messageId, conversationId, rating }) });
}
