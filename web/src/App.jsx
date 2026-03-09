import { useMemo, useRef, useState } from 'react';

const API_BASE = 'http://localhost:4000';

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Welcome to Enterprise AI Assistant Phase 3. Authenticate with a tenant token, then chat or use RAG.'
    }
  ]);
  const [token, setToken] = useState('acme-admin-token');
  const [identity, setIdentity] = useState(null);
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

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token.trim()}`
  });

  const connectIdentity = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token.trim()}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      setIdentity(data.user);
      setUploadStatus(`Authenticated as ${data.user.name} (${data.user.role}) in ${data.user.orgSlug}.`);
    } catch (error) {
      setIdentity(null);
      setUploadStatus(`Auth error: ${error.message}`);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    if (!identity) {
      setUploadStatus('Authenticate first using a valid token.');
      return;
    }

    const userMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const endpoint = ragMode ? '/api/chat/rag' : '/api/chat';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: authHeaders(),
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
    if (!identity) {
      setUploadStatus('Authenticate first using a valid token.');
      event.target.value = '';
      return;
    }

    setUploading(true);
    setUploadStatus(`Uploading ${file.name}...`);

    try {
      const formData = new FormData();
      formData.append('document', file);

      const res = await fetch(`${API_BASE}/api/knowledge/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token.trim()}`
        },
        body: formData
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setUploadStatus(
        `Indexed ${data.source} (${data.chunksAdded} chunks). Total indexed: ${data.chunksIndexed}. Org: ${data.org}.`
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
      <div className="subtitle">Phase 3: Multi-Tenant Auth + RBAC + Persistent Storage</div>

      <section className="panel">
        <div className="panel-row">
          <label className="upload-label auth-field">
            <span>API Token</span>
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter tenant token"
            />
          </label>
          <button type="button" onClick={connectIdentity}>Authenticate</button>
        </div>
        <div className="status">
          {identity
            ? `Connected: ${identity.name} (${identity.role}) @ ${identity.orgSlug}`
            : 'Not authenticated'}
        </div>
      </section>

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
