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
  const abortControllerRef = useRef<AbortController | null>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const stopGenerating = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setError('已停止回答');
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    setError('');

    const userMsg: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages }),
        signal: controller.signal,
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
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('已停止回答');
      } else {
        console.error(err);
        setError('请求异常，请稍后重试');
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-full p-4 md:p-6">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col rounded-2xl border border-zinc-200 bg-white/90 shadow-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-900 md:text-2xl">DeepSeek Chat</h1>
            <p className="mt-1 text-xs text-zinc-500 md:text-sm">支持流式回复的 AI 助手</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            退出登录
          </button>
        </div>

        <div
          ref={messagesEndRef}
          className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-zinc-50 to-white px-4 py-5 md:px-6"
        >
          {messages.length === 0 ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-zinc-200 bg-white p-5 text-center text-zinc-500">
              试试问我：帮我写一个注册登录接口，或者解释一段代码。
            </div>
          ) : null}

          {messages.map((msg, index) => (
            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 md:max-w-[75%] md:text-base ${msg.role === 'user'
                  ? 'rounded-br-md bg-blue-600 text-white shadow-sm'
                  : 'rounded-bl-md border border-zinc-200 bg-white text-zinc-800'
                  }`}
              >
                {msg.content || (msg.role === 'assistant' && loading ? '思考中...' : '')}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-zinc-100 px-4 py-4 md:px-6">
          <form onSubmit={sendMessage} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题，按回车发送..."
              disabled={loading}
              className="h-11 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-zinc-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            {loading ? (
              <button
                type="button"
                onClick={stopGenerating}
                className="h-11 rounded-xl bg-rose-600 px-5 text-sm font-medium text-white transition hover:bg-rose-700"
              >
                停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="h-11 rounded-xl bg-blue-600 px-5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                发送
              </button>
            )}
          </form>
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}