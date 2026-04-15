import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 30;

type ChatProvider = 'deepseek' | 'zhipu';

const PROVIDER_CONFIG: Record<
  ChatProvider,
  { apiKeyEnv: 'DEEPSEEK_API_KEY' | 'ZHIPU_API_KEY'; baseURL: string; model: string }
> = {
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  zhipu: {
    apiKeyEnv: 'ZHIPU_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4',
  },
};

function resolveProvider(body: unknown): ChatProvider {
  const p = (body as { provider?: string } | null)?.provider;
  return p === 'zhipu' ? 'zhipu' : 'deepseek';
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ message: '未登录或登录已失效' }, { status: 401 });
  }

  const body = await req.json();
  const provider = resolveProvider(body);
  const { messages } = body as { messages: OpenAI.Chat.ChatCompletionMessageParam[] };

  const cfg = PROVIDER_CONFIG[provider];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    return Response.json(
      { message: `未配置环境变量 ${cfg.apiKeyEnv}，无法使用该模型` },
      { status: 503 }
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: cfg.baseURL,
  });

  const stream = await client.chat.completions.create({
    model: cfg.model,
    messages,
    stream: true,
    temperature: 0.7,
  });

  // 关键：把流式 JSON 转成纯文本 content
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) {
          controller.enqueue(encoder.encode(content));
        }
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}