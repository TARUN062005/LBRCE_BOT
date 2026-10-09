import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import { Sidebar } from './components/Sidebar';
import { getSessionId } from './lib/session';
import { AdminHome, DocumentsAdmin, IngestionAdmin, LoginPage, RetrievalAdmin, TimetableAdmin } from './pages/AdminPages';
import { ChatPage } from './pages/ChatPage';
import { FacultyPage, NoticesPage, SettingsPage, TimetablePage } from './pages/ResourcePages';

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
    <div className="min-h-screen bg-canvas lg:flex">
      <Sidebar
        open={open}
        onClose={() => setOpen((current) => !current)}
        conversations={conversations}
        onNew={() => openFreshChat()}
        onAsk={(question) => openFreshChat(question)}
        onSelect={(id) => {
          setConversationId(id);
          setOpen(false);
          navigate('/');
        }}
      />
      <main className="min-w-0 flex-1">
        <Routes>
          <Route
            path="/"
            element={<ChatPage key={chatKey} conversationId={conversationId} initialDraft={draftSeed} onConversation={setConversationId} />}
          />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/calendar" element={<NoticesPage documentType="calendar" title="Academic calendar" description="Published academic calendar documents from the index." />} />
          <Route path="/faculty" element={<FacultyPage />} />
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
