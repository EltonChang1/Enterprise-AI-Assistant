import { useMemo, useRef, useState } from 'react';

const API_BASE = 'http://localhost:4000';

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Welcome to Enterprise AI Assistant Phase 1. Ask me anything related to your business workflows.'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ragMode, setRagMode] = useState(true);
  const [uploadStatus, setUploadStatus] = useState('No documents uploaded yet.');
  const [contextUsed, setContextUsed] = useState([]);
  const chatRef = useRef(null);

  const conversation = useMemo(
    () => messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    [messages]
  );

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const endpoint = ragMode ? '/api/chat/rag' : '/api/chat';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

      setContextUsed(data.contextUsed || []);

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.message || 'No response generated.' }
      ]);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${error.message}` }
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        if (chatRef.current) {
          chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
      });
    }
  };

  const uploadDocument = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('document', file);

      const res = await fetch(`${API_BASE}/api/knowledge/upload`, {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setUploadStatus(
        `Indexed ${data.source} (${data.chunksAdded} chunks). Total indexed: ${data.chunksIndexed}.`
      );
    } catch (error) {
      setUploadStatus(`Upload error: ${error.message}`);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <main className="app">
      <h1>Enterprise AI Assistant</h1>
      <div className="subtitle">Phase 2: Document Upload + RAG Chat</div>

      <section className="panel">
        <div className="panel-row">
          <label className="upload-label">
            <span>{uploading ? 'Uploading...' : 'Upload Knowledge Document (.txt/.md/.json/.csv)'}</span>
            <input type="file" onChange={uploadDocument} disabled={uploading} />
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ragMode}
              onChange={(e) => setRagMode(e.target.checked)}
            />
            <span>RAG Mode</span>
          </label>
        </div>
        <div className="status">{uploadStatus}</div>
        {contextUsed.length > 0 && (
          <div className="status">
            Context used: {contextUsed.map((item) => `${item.source} (${item.score})`).join(', ')}
          </div>
        )}
      </section>

      <section className="chatbox" ref={chatRef}>
        {conversation.map((msg, idx) => (
          <div key={`${msg.role}-${idx}`} className={`msg ${msg.role}`}>
            <strong>{msg.role === 'assistant' ? 'Assistant' : 'You'}:</strong>
            <div>{msg.content}</div>
          </div>
        ))}
      </section>

      <form onSubmit={sendMessage}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a question for your enterprise assistant..."
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </main>
  );
}
