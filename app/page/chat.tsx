'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    setError('');

    const userMsg: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
      });
      if (res.status === 401) {
        setError('登录状态已失效，请重新登录');
        return;
      }
      if (!res.ok) {
        setError('请求失败，请稍后重试');
        return;
      }

      if (!res.body) throw new Error('无流数据');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let answer = '';
      setMessages([...newMessages, { role: 'assistant', content: '' }]);

      while (!done) {
        const { value, done: d } = await reader.read();

        done = d;
        const text = decoder.decode(value, { stream: true });
        answer += text;

        setMessages(prev =>
          prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: answer } : m
          )
        );
      }
    } catch (err) {
      console.error(err);
      setError('请求异常，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-3xl h-screen flex flex-col p-4">
      <div className="my-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">DeepSeek AI 聊天</h1>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          退出登录
        </button>
      </div>

      {/* 消息区域 */}
      <div className="flex-1 bg-gray-50 rounded-xl p-4 overflow-y-auto flex flex-col gap-3">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[80%] whitespace-pre-wrap px-4 py-3 rounded-2xl ${msg.role === 'user'
                ? 'bg-blue-600 text-white self-end'
                : 'bg-white text-gray-800 self-start shadow-sm'
              }`}
          >
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <form onSubmit={sendMessage} className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的问题..."
          disabled={loading}
          className="flex-1 border border-gray-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-blue-600 text-white px-5 py-3 rounded-xl hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? '发送中...' : '发送'}
        </button>
      </form>
      {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}