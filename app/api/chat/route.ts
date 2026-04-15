import OpenAI from 'openai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

function buildConversationTitle(content: string) {
  const text = content.trim();
  if (!text) return '新对话';
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email?.trim().toLowerCase();
  if (!userEmail) {
    return Response.json({ message: '未登录或登录已失效' }, { status: 401 });
  }

  const body = await req.json();
  const provider = resolveProvider(body);
  const { messages, conversationId } = body as {
    messages: OpenAI.Chat.ChatCompletionMessageParam[];
    conversationId?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ message: '消息不能为空' }, { status: 400 });
  }
  if (!conversationId) {
    return Response.json({ message: '缺少 conversationId' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    select: { id: true },
  });
  if (!user) {
    return Response.json({ message: '用户不存在' }, { status: 401 });
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true, title: true },
  });
  if (!conversation) {
    return Response.json({ message: '会话不存在或无权限' }, { status: 404 });
  }

  const lastMessage = messages[messages.length - 1];
  const latestUserMessage =
    lastMessage?.role === 'user' && typeof lastMessage.content === 'string'
      ? lastMessage.content.trim()
      : '';
  if (!latestUserMessage) {
    return Response.json({ message: '最后一条消息必须是用户消息' }, { status: 400 });
  }

  const titleToSave =
    conversation.title === '新对话' ? buildConversationTitle(latestUserMessage) : conversation.title;

  await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'user',
        content: latestUserMessage,
        provider,
      },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        title: titleToSave,
        updatedAt: new Date(),
      },
    }),
  ]);

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
      let answer = '';
      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            answer += content;
            controller.enqueue(encoder.encode(content));
          }
        }

        if (answer.trim()) {
          await prisma.$transaction([
            prisma.chatMessage.create({
              data: {
                conversationId: conversation.id,
                role: 'assistant',
                content: answer,
                provider,
              },
            }),
            prisma.conversation.update({
              where: { id: conversation.id },
              data: {
                updatedAt: new Date(),
              },
            }),
          ]);
        }

        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}