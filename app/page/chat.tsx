'use client';

import { useState, useRef, useEffect } from 'react';
import { signOut } from 'next-auth/react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatProvider = 'deepseek' | 'zhipu';
type ConversationItem = {
  id: string;
  title: string;
  updatedAt: string;
  _count: { messages: number };
};

const PROVIDER_LABEL: Record<ChatProvider, string> = {
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM-4',
};

const PROVIDER_STORAGE_KEY = 'chat-provider';

export default function ChatPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [error, setError] = useState('');
  const [provider, setProvider] = useState<ChatProvider>('deepseek');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PROVIDER_STORAGE_KEY) as ChatProvider | null;
      if (saved === 'deepseek' || saved === 'zhipu') setProvider(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const onProviderChange = (next: ChatProvider) => {
    setProvider(next);
    try {
      localStorage.setItem(PROVIDER_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    // 切换模型时如果已有对话则新建对话
    if (messages?.length) {
      addChat();
    }
  };

  // 自动滚动到底部
  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollTop = messagesEndRef.current.scrollHeight;
  }, [messages]);

  const addChat = () => {
    setError('');
    void createConversation().catch(() => setError('创建会话失败'));
  }

  const refreshConversations = async () => {
    const res = await fetch('/api/conversations');
    if (!res.ok) throw new Error('获取会话列表失败');
    const data = (await res.json()) as { conversations: ConversationItem[] };
    setConversations(data.conversations);
    return data.conversations;
  };

  const loadMessages = async (conversationId: string) => {
    const res = await fetch(`/api/conversations/${conversationId}/messages`);
    if (!res.ok) {
      throw new Error('获取会话消息失败');
    }
    const data = (await res.json()) as { messages: Array<{ role: string; content: string; provider: ChatProvider }> };
    setProvider(data.messages[0]?.provider)
    setMessages(
      data.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    );
  };

  const createConversation = async () => {
    const res = await fetch('/api/conversations', { method: 'POST' });
    if (!res.ok) {
      throw new Error('创建会话失败');
    }
    const data = (await res.json()) as { conversation: ConversationItem };
    setConversations(prev => [data.conversation, ...prev.filter(item => item.id !== data.conversation.id)]);
    setActiveConversationId(data.conversation.id);
    setMessages([]);
    return data.conversation.id;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingConversations(true);
        const list = await refreshConversations();
        if (!cancelled && list.length > 0) {
          setActiveConversationId(list[0].id);
          await loadMessages(list[0].id);
        }
      } catch {
        if (!cancelled) setError('加载会话失败，请刷新重试');
      } finally {
        if (!cancelled) setLoadingConversations(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectConversation = async (conversationId: string) => {
    if (loading || conversationId === activeConversationId) return;
    setError('');
    setActiveConversationId(conversationId);
    try {
      await loadMessages(conversationId);
    } catch {
      setError('加载会话消息失败');
    }
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
      const conversationId = activeConversationId ?? (await createConversation());
      const activeProvider = provider;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          provider: activeProvider,
          conversationId,
        }),
        signal: controller.signal,
      });
      if (res.status === 401) {
        setError('登录状态已失效，请重新登录');
        return;
      }
      if (res.status === 503) {
        try {
          const data = (await res.json()) as { message?: string };
          setError(data.message ?? '当前模型不可用，请检查服务端配置');
        } catch {
          setError('当前模型不可用，请检查服务端配置');
        }
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
          prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: answer } : m))
        );
      }
      await refreshConversations();
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
      <div className="mx-auto flex h-full w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 shadow-sm">
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-100 bg-zinc-50/80">
          <div className="space-y-3 border-b border-zinc-100 p-4">
            <button
              type="button"
              disabled={loading}
              onClick={addChat}
              className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              + 新对话
            </button>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              退出登录
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {loadingConversations ? (
              <p className="px-2 py-4 text-sm text-zinc-500">加载会话中...</p>
            ) : conversations.length === 0 ? (
              <p className="px-2 py-4 text-sm text-zinc-500">暂无历史会话，点击上方“新对话”开始。</p>
            ) : (
              conversations.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    void selectConversation(item.id);
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${activeConversationId === item.id
                    ? 'border-blue-200 bg-blue-50 text-blue-700'
                    : 'border-transparent bg-white text-zinc-700 hover:border-zinc-200'
                    }`}
                >
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-zinc-500">{item._count.messages} 条消息</p>
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 md:text-2xl">AI 对话</h1>
              <p className="mt-1 text-xs text-zinc-500 md:text-sm">
                当前模型：{PROVIDER_LABEL[provider]} · 支持流式回复
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <span className="whitespace-nowrap">模型</span>
              <select
                value={provider}
                onChange={e => onProviderChange(e.target.value as ChatProvider)}
                disabled={loading}
                className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-zinc-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
              >
                <option value="deepseek">DeepSeek</option>
                <option value="zhipu">智谱 GLM</option>
              </select>
            </label>
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
                onChange={e => setInput(e.target.value)}
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
    </div>
  );
}