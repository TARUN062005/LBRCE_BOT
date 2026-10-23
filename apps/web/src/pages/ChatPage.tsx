import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Send, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { SUGGESTED_QUESTIONS, type AnswerBlock, type ChatResponse } from '@lbrce/shared';
import { api, streamChat } from '../api/client';
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

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    void api<{ messages: { id: string; role: 'user' | 'assistant'; content: string; blocks: AnswerBlock[] }[] }>(
      `/api/chat/${conversationId}?sessionId=${getSessionId()}`,
    )
      .then((result) => setMessages(result.messages))
      .catch(() => setError('This conversation could not be loaded.'));
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
    setStatus('Searching indexed college sources');
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: message }]);
    try {
      await streamChat(
        { message, sessionId: getSessionId(), conversationId },
        {
          onStatus: setStatus,
          onToken: (token) => setStreaming((current) => current + token),
          onDone: (response) => {
            setStreaming('');
            setStatus('');
            onConversation(response.conversationId);
            setRelated(response.relatedQuestions ?? []);
            setMessages((current) => [...current, assistantFrom(response)]);
          },
        },
      );
    } catch (caught) {
      setStatus('');
      setStreaming('');
      setError(caught instanceof Error ? caught.message : 'The request failed.');
    } finally {
      busy.current = false;
    }
  }

  const thinking = Boolean(status);
  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,_#e7f0f8_0,_#f4f7fb_42%)] pt-16 lg:pt-0">
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
        onScroll={() => {
          const node = scroller.current;
          if (!node) return;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          {messages.length === 0 ? <Welcome onPick={(question) => void submit(question)} /> : null}
          {messages.map((message) => (
            <article key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'assistant' ? <Mark /> : null}
              <div className={message.role === 'user' ? 'max-w-[85%]' : 'min-w-0 flex-1'}>
                <div className={message.role === 'user' ? 'rounded-3xl rounded-br-md bg-brand px-4 py-3 text-white shadow-card' : 'overflow-x-auto rounded-3xl rounded-bl-md border border-line bg-white px-4 py-4 shadow-card'}>
                  {message.role === 'assistant' && message.blocks ? (
                    <AnswerBlocks blocks={message.blocks} onChoose={thinking ? undefined : (option) => void submit(option)} />
                  ) : (
                    <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
                  )}
                </div>
                {message.role === 'assistant' ? (
                  <div className="no-print mt-1.5 flex gap-1 text-muted">
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
          {thinking || streaming ? <Reasoning label={status || 'Writing the answer'} text={streaming} /> : null}
          {related.length ? (
            <div className="flex flex-wrap gap-2 pl-11">
              {related.map((question) => (
                <button key={question} type="button" className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm shadow-card hover:border-brand" onClick={() => void submit(question)}>
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
        className="no-print shrink-0 border-t border-line/80 bg-white/90 px-4 py-3 backdrop-blur sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <div className="mx-auto flex max-w-4xl items-end gap-2 rounded-3xl border border-line bg-white p-2 shadow-card focus-within:border-brand">
          <textarea
            aria-label="Message"
            value={draft}
            rows={2}
            placeholder="Ask about LBRCE departments, timetables, examinations, admissions, or notices"
            className="max-h-40 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 outline-none"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit(draft);
              }
            }}
          />
          <button type="submit" aria-label="Send" className="mb-1 inline-flex h-11 items-center gap-2 rounded-2xl bg-brand px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-brand/40" disabled={!draft.trim() || thinking}>
            <Send size={16} />
            Send
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-4xl text-xs text-muted">Enter sends. Shift+Enter adds a line. Timetables, calendars, faculty, notices, and campus images are shown in this chat. Links stay on lbrce.ac.in.</p>
      </form>
    </section>
  );
}

function Mark() {
  return (
    <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white" aria-hidden="true">
      AI
    </span>
  );
}

function Reasoning({ label, text }: { label: string; text: string }) {
  return (
    <article className="flex gap-3" aria-live="polite">
      <Mark />
      <div className="min-w-0 flex-1 rounded-3xl rounded-bl-md border border-brand/15 bg-white px-4 py-3 shadow-card">
        <div className="flex items-center gap-3">
          <span className="think-ring" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-ink">Thinking</p>
            <p className="text-sm text-muted">{label}</p>
          </div>
        </div>
        {text ? (
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-ink">
            {text}
            <span className="think-caret" aria-hidden="true" />
          </p>
        ) : (
          <div className="mt-3 flex items-center gap-1.5" aria-hidden="true">
            <span className="think-dot" />
            <span className="think-dot" style={{ animationDelay: '0.15s' }} />
            <span className="think-dot" style={{ animationDelay: '0.3s' }} />
          </div>
        )}
        <div className="think-bar mt-3" aria-hidden="true" />
      </div>
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
          <h2 className="text-3xl font-semibold tracking-tight">Ask the college assistant</h2>
        </div>
      </div>
      <p className="max-w-xl text-muted">
        Ask here for timetables, the academic calendar, faculty, notices, admissions, and examinations. Older replies stay in this chat and come back when you scroll up.
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
