'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/',
      });
      if (!result) {
        setMessage('登录失败，请稍后重试');
        return;
      }

      if (result.error) {
        setMessage('邮箱或密码错误');
        return;
      }

      if (result.ok) {
        router.push(result.url ?? '/');
        router.refresh();
      }
    } catch {
      setMessage('登录失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });

      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        setMessage(data.message ?? '注册失败');
        return;
      }

      setMessage('注册成功，请点击“立即登录”');
      setRegistering(false);
    } catch {
      setMessage('注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50">
      <form
        onSubmit={registering ? handleRegister : handleLogin}
        className="w-full max-w-sm bg-white rounded-xl border border-zinc-200 shadow-sm p-6 space-y-3"
      >
        <h1 className="text-xl font-semibold text-zinc-900">
          {registering ? '创建账户' : '登录 DeepSeek Chat'}
        </h1>

        {registering ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-zinc-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="昵称（可选）"
          />
        ) : null}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="邮箱"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-zinc-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400"
          placeholder="密码（至少 6 位）"
          required
        />

        {message ? <p className="text-sm text-red-600">{message}</p> : null}

        <button
          type="submit"
          disabled={loading || !email.trim() || !password.trim()}
          className="w-full bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700 transition disabled:opacity-60"
        >
          {loading ? '处理中...' : registering ? '注册' : '立即登录'}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setMessage('');
            setRegistering((v) => !v);
          }}
          className="w-full text-zinc-700 rounded-lg py-2 border border-zinc-300 hover:bg-zinc-50 transition disabled:opacity-60"
        >
          {registering ? '已有账号，去登录' : '没有账号，先注册'}
        </button>
      </form>
    </main>
  );
}
