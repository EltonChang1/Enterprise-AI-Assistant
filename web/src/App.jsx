import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = 'http://localhost:4000';
const WS_BASE = 'ws://localhost:4000';

export default function App() {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'Welcome to Enterprise AI Assistant Phase 4. Authenticate, then use chat/RAG/streaming/agent modes.'
    }
  ]);
  const [token, setToken] = useState('acme-admin-token');
  const [identity, setIdentity] = useState(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ragMode, setRagMode] = useState(true);
  const [streamMode, setStreamMode] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('No documents uploaded yet.');
  const [contextUsed, setContextUsed] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const chatRef = useRef(null);
  const wsRef = useRef(null);

  const conversation = useMemo(
    () => messages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    [messages]
  );

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token.trim()}`
  });

  const initWebSocket = () => {
    if (wsRef.current) return;

    const ws = new WebSocket(WS_BASE);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: token.trim() }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'auth_success') {
          setUploadStatus(`WebSocket authenticated as ${data.user.name} (${data.user.role})`);
        } else if (data.type === 'chunk') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              return [
                ...prev.slice(0, -1),
                { role: 'assistant', content: last.content + data.content, streaming: true }
              ];
            }
            return [...prev, { role: 'assistant', content: data.content, streaming: true }];
          });
        } else if (data.type === 'done') {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.streaming) {
              return [...prev.slice(0, -1), { role: 'assistant', content: last.content }];
            }
            return prev;
          });
          setLoading(false);
        } else if (data.type === 'error') {
          setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.message}` }]);
          setLoading(false);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setLoading(false);
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const connectIdentity = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token.trim()}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      setIdentity(data.user);
      setUploadStatus(`Authenticated as ${data.user.name} (${data.user.role}) in ${data.user.orgSlug}.`);

      if (streamMode) {
        initWebSocket();
      }
    } catch (error) {
      setIdentity(null);
      setUploadStatus(`Auth error: ${error.message}`);
    }
  };

  const fetchAnalytics = async () => {
    if (!identity || identity.role !== 'admin') {
      setUploadStatus('Analytics requires admin role.');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/analytics/overview`, {
        headers: authHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analytics fetch failed');
      setAnalytics(data);
      setShowAnalytics(true);
    } catch (error) {
      setUploadStatus(`Analytics error: ${error.message}`);
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
      if (streamMode) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          initWebSocket();
          await new Promise((resolve) => setTimeout(resolve, 500));
        }

        wsRef.current.send(
          JSON.stringify({
            type: 'chat_stream',
            messages: nextMessages,
            mode: ragMode ? 'rag' : 'chat'
          })
        );

        requestAnimationFrame(() => {
          if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
          }
        });
        return;
      }

      if (agentMode) {
        const res = await fetch(`${API_BASE}/api/chat/agent`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ messages: nextMessages })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');

        let responseContent = data.message || 'No response generated.';
        if (data.toolCalls && data.toolCalls.length > 0) {
          responseContent +=
            '\n\nTools used:\n' +
            data.toolCalls.map((tc) => `- ${tc.tool}(${JSON.stringify(tc.arguments)})`).join('\n');
        }

        setMessages((prev) => [...prev, { role: 'assistant', content: responseContent }]);
      } else {
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
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${error.message}` }
      ]);
    } finally {
      if (!streamMode) {
        setLoading(false);
      }
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
      <div className="subtitle">Phase 4: WebSocket Streaming + Agent Tools + Analytics</div>

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
          <button type="button" onClick={connectIdentity}>
            Authenticate
          </button>
          {identity?.role === 'admin' && (
            <button type="button" onClick={fetchAnalytics}>
              {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
            </button>
          )}
        </div>
        <div className="status">
          {identity
            ? `Connected: ${identity.name} (${identity.role}) @ ${identity.orgSlug}`
            : 'Not authenticated'}
        </div>
      </section>

      {showAnalytics && analytics && (
        <section className="panel">
          <h3>Analytics Overview</h3>
          <ul>
            <li>Total Chats: {analytics.totalChats}</li>
            <li>RAG Chats: {analytics.ragChats}</li>
            <li>Regular Chats: {analytics.regularChats}</li>
            <li>Total Documents: {analytics.totalDocuments}</li>
            <li>Total Knowledge Chunks: {analytics.totalChunks}</li>
            {analytics.recentActivity && analytics.recentActivity.length > 0 && (
              <li>
                Last 7 days:{' '}
                {analytics.recentActivity.map((a) => `${a.mode}:${a.count}`).join(', ')}
              </li>
            )}
          </ul>
        </section>
      )}

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
              onChange={(e) => {
                setRagMode(e.target.checked);
                if (e.target.checked && agentMode) setAgentMode(false);
              }}
            />
            <span>RAG</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={streamMode}
              onChange={(e) => {
                setStreamMode(e.target.checked);
                if (e.target.checked && !wsRef.current) initWebSocket();
              }}
            />
            <span>Stream</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={agentMode}
              onChange={(e) => {
                setAgentMode(e.target.checked);
                if (e.target.checked && ragMode) setRagMode(false);
              }}
            />
            <span>Agent</span>
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
