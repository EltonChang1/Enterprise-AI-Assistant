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
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');

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

  return (
    <main className="app">
      <h1>Enterprise AI Assistant</h1>
      <div className="subtitle">Phase 1: Core Chat + API Integration</div>

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
