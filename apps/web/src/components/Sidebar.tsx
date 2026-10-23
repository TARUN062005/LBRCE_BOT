import { Menu, MessageSquarePlus, Trash2 } from 'lucide-react';
import { SUGGESTED_QUESTIONS } from '@lbrce/shared';

export function Sidebar({
  open,
  onClose,
  conversations,
  onNew,
  onSelect,
  onAsk,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  conversations: { id: string; title: string }[];
  onNew: () => void;
  onSelect: (id: string) => void;
  onAsk?: (question: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <>
      <button type="button" className="no-print fixed left-4 top-4 z-40 rounded-lg border border-line bg-white p-2 shadow-card lg:hidden" aria-label="Open navigation" onClick={onClose}>
        <Menu size={18} />
      </button>
      <div className={`fixed inset-0 z-40 bg-ink/40 lg:hidden ${open ? 'block' : 'hidden'}`} onClick={onClose} />
      <aside className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-white transition-transform lg:static lg:h-dvh lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="bg-brand px-4 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Mylavaram</p>
          <h1 className="text-xl font-semibold">LBRCE AI</h1>
          <p className="mt-1 text-sm text-white/80">Official college answers, with sources.</p>
        </div>
        <div className="space-y-2 px-4 py-4">
          <button type="button" onClick={onNew} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
            <MessageSquarePlus size={16} /> New chat
          </button>
        </div>
        <div className="px-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent</p>
          <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
            {conversations.length === 0 ? <li className="text-sm text-muted">No conversations yet.</li> : null}
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex items-center gap-1">
                <button type="button" className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-canvas" onClick={() => onSelect(conversation.id)}>
                  {conversation.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${conversation.title}`}
                  className="rounded-md p-1.5 text-muted hover:bg-red-50 hover:text-red-700"
                  onClick={() => {
                    if (window.confirm(`Delete “${conversation.title}”?`)) onDelete?.(conversation.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto px-4 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Ask in chat</p>
          <ul className="mt-2 space-y-1">
            {SUGGESTED_QUESTIONS.slice(0, 6).map((question) => (
              <li key={question}>
                <button type="button" className="w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-brand-light" onClick={() => onAsk?.(question)}>
                  {question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}
