import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import { Sidebar } from './components/Sidebar';
import { getSessionId } from './lib/session';
import { AdminHome, DocumentsAdmin, IngestionAdmin, LoginPage, RetrievalAdmin, TimetableAdmin } from './pages/AdminPages';
import { ChatPage } from './pages/ChatPage';

export function App() {
  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route path="/admin" element={<AdminHome />} />
      <Route path="/admin/ingestion" element={<IngestionAdmin />} />
      <Route path="/admin/documents" element={<DocumentsAdmin />} />
      <Route path="/admin/timetables" element={<TimetableAdmin />} />
      <Route path="/admin/retrieval" element={<RetrievalAdmin />} />
      <Route path="/*" element={<StudentShell />} />
    </Routes>
  );
}

function StudentShell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const [chatKey, setChatKey] = useState(0);
  const [draftSeed, setDraftSeed] = useState('');

  function refresh() {
    void api<{ data: { id: string; title: string }[] }>(`/api/chat/history?sessionId=${getSessionId()}`)
      .then((result) => setConversations(result.data))
      .catch(() => setConversations([]));
  }

  useEffect(() => {
    refresh();
  }, [conversationId]);

  function openFreshChat(draft = '') {
    setConversationId(undefined);
    setDraftSeed(draft);
    setChatKey((current) => current + 1);
    setOpen(false);
    navigate('/');
  }

  return (
    <div className="h-dvh overflow-hidden bg-canvas lg:flex">
      <Sidebar
        open={open}
        onClose={() => setOpen((current) => !current)}
        conversations={conversations}
        onNew={() => openFreshChat()}
        onAsk={(question) => openFreshChat(question)}
        onSelect={(id) => {
          setConversationId(id);
          setDraftSeed('');
          setChatKey((current) => current + 1);
          setOpen(false);
          navigate('/');
        }}
        onDelete={(id) => {
          void api(`/api/chat/${id}?sessionId=${getSessionId()}`, { method: 'DELETE' })
            .then(() => {
              setConversations((current) => current.filter((conversation) => conversation.id !== id));
              if (conversationId === id) openFreshChat();
            })
            .catch(() => undefined);
        }}
      />
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <Routes>
          <Route
            path="/"
            element={<ChatPage key={chatKey} conversationId={conversationId} initialDraft={draftSeed} onConversation={setConversationId} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
