import { useEffect, useRef, useState } from 'react';
import { Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
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
  const bottom = useRef<HTMLDivElement>(null);

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
    bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming, status]);

  async function submit(text: string) {
    const message = text.trim();
    if (!message) return;
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
    }
  }

  return (
    <section className="flex min-h-screen flex-1 flex-col pt-16 lg:pt-0">
      <div className="flex-1 space-y-4 overflow-auto px-4 py-6 sm:px-8">
        {messages.length === 0 ? <Welcome onPick={(question) => void submit(question)} /> : null}
        {messages.map((message) => (
          <article key={message.id} className={`max-w-3xl ${message.role === 'user' ? 'ml-auto' : ''}`}>
            <div className={`rounded-2xl px-4 py-3 shadow-card ${message.role === 'user' ? 'bg-brand text-white' : 'border border-line bg-white'}`}>
              {message.role === 'assistant' && message.blocks ? <AnswerBlocks blocks={message.blocks} /> : <p className="whitespace-pre-wrap">{message.content}</p>}
            </div>
            {message.role === 'assistant' ? (
              <div className="no-print mt-2 flex gap-2 text-muted">
                <button type="button" aria-label="Copy answer" onClick={() => void navigator.clipboard?.writeText(message.content)}>
                  <Copy size={16} />
                </button>
                <button type="button" aria-label="Helpful" onClick={() => void feedback(message.id, conversationId, 'up')}>
                  <ThumbsUp size={16} />
                </button>
                <button type="button" aria-label="Not helpful" onClick={() => void feedback(message.id, conversationId, 'down')}>
                  <ThumbsDown size={16} />
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {streaming ? (
          <article className="max-w-3xl rounded-2xl border border-line bg-white px-4 py-3 shadow-card">
            <p className="whitespace-pre-wrap">{streaming}</p>
          </article>
        ) : null}
        {status ? <p className="text-sm text-muted">{status}</p> : null}
        {related.length ? (
          <div className="flex max-w-3xl flex-wrap gap-2">
            {related.map((question) => (
              <button key={question} type="button" className="rounded-full border border-line bg-white px-3 py-1.5 text-left text-sm hover:border-brand" onClick={() => void submit(question)}>
                {question}
              </button>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p>{error}</p>
            <button type="button" className="mt-2 font-semibold" onClick={() => void submit(messages.filter((item) => item.role === 'user').at(-1)?.content ?? '')}>
              Retry
            </button>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      <form
        className="no-print sticky bottom-0 border-t border-line bg-canvas/95 px-4 py-3 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(draft);
        }}
      >
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            aria-label="Message"
            value={draft}
            rows={2}
            placeholder="Ask about LBRCE departments, timetables, examinations, admissions, or notices"
            className="min-h-14 flex-1 resize-y rounded-xl border border-line bg-white px-3 py-2 outline-none focus:border-brand"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit(draft);
              }
            }}
          />
          <button type="submit" className="rounded-xl bg-brand px-4 py-3 font-semibold text-white" disabled={!draft.trim()}>
            Send
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-xs text-muted">
          Enter sends. Shift+Enter adds a line. Answers come from the indexed official pages and include links to those pages. A question does not download the website again.
        </p>
      </form>
    </section>
  );
}

function Welcome({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl pt-10">
      <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand">Lakireddy Bali Reddy College of Engineering</p>
      <h2 className="mt-2 text-3xl font-semibold">Ask the college assistant</h2>
      <p className="mt-3 max-w-2xl text-muted">
        LBRCE AI answers from retrieved official pages, uploaded notices, and verified timetable records. It does not invent faculty, fees, rooms, results, or placement numbers.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {SUGGESTED_QUESTIONS.slice(0, 6).map((question) => (
          <button key={question} type="button" className="rounded-full border border-line bg-white px-3 py-2 text-left text-sm hover:border-brand" onClick={() => onPick(question)}>
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
