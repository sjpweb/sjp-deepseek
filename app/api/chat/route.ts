// 导入 OpenAI SDK（用于调用兼容 OpenAI 格式的大模型）
import OpenAI from 'openai';
// 导入 NextAuth 会话获取方法（校验用户登录状态）
import { getServerSession } from 'next-auth';
// 导入 NextAuth 配置
import { authOptions } from '@/lib/auth';
// 导入 Prisma 数据库客户端
import { prisma } from '@/lib/prisma';

// 指定运行时为 Node.js
export const runtime = 'nodejs';
// 最大执行时长 30 秒
export const maxDuration = 300;

// 定义支持的 AI 服务商类型：深度求索 / 智谱
type ChatProvider = 'deepseek' | 'zhipu';

// 服务商配置映射表
const PROVIDER_CONFIG: Record<
  ChatProvider,
  { apiKeyEnv: 'DEEPSEEK_API_KEY' | 'ZHIPU_API_KEY'; baseURL: string; model: string }
> = {
  deepseek: {
    apiKeyEnv: 'DEEPSEEK_API_KEY', // 环境变量名
    baseURL: 'https://api.deepseek.com', // API 地址
    model: 'deepseek-chat', // 模型名
  },
  zhipu: {
    apiKeyEnv: 'ZHIPU_API_KEY',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    model: 'glm-4',
  },
};

/**
 * 从请求 body 解析出使用哪个 AI 服务商
 * 默认用 deepseek
 */
function resolveProvider(body: unknown): ChatProvider {
  const p = (body as { provider?: string } | null)?.provider;
  return p === 'zhipu' ? 'zhipu' : 'deepseek';
}

/**
 * 生成对话标题：取用户第一条消息前 24 个字符
 */
function buildConversationTitle(content: string) {
  const text = content.trim();
  if (!text) return '新对话';
  return text.length > 24 ? `${text.slice(0, 24)}...` : text;
}

// ======================
// ✅ Tavily 搜索函数（已集成）
// ======================
async function tavilySearch(query: string) {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query,
        search_depth: 'basic',
        max_results: 3,
      }),
    });

    if (!res.ok) throw new Error('Tavily API 请求失败');
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error('搜索失败：', err);
    return [];
  }
}

/**
 * POST 接口：处理聊天请求
 * 1. 校验登录
 * 2. 校验消息/会话
 * 3. 存用户消息到数据库
 * 4. 调用 AI 流式返回
 * 5. 存 AI 回答到数据库
 */
export async function POST(req: Request) {
  // ==============================================
  // 1. 校验用户是否登录
  // ==============================================
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email?.trim().toLowerCase();
  if (!userEmail) {
    return Response.json({ message: '未登录或登录已失效' }, { status: 401 });
  }

  // ==============================================
  // 2. 解析请求体
  // ==============================================
  const body = await req.json();
  const provider = resolveProvider(body); // 确定用哪个模型
  const { messages, conversationId, enableSearch } = body as {
    messages: OpenAI.Chat.ChatCompletionMessageParam[];
    conversationId?: string;
    enableSearch?: boolean;
  };

  // ==============================================
  // 3. 基础参数校验
  // ==============================================
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ message: '消息不能为空' }, { status: 400 });
  }
  if (!conversationId) {
    return Response.json({ message: '缺少 conversationId' }, { status: 400 });
  }

  // ==============================================
  // 4. 校验用户是否存在
  // ==============================================
  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    select: { id: true },
  });
  if (!user) {
    return Response.json({ message: '用户不存在' }, { status: 401 });
  }

  // ==============================================
  // 5. 校验对话是否属于当前用户
  // ==============================================
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: { id: true, title: true },
  });
  if (!conversation) {
    return Response.json({ message: '会话不存在或无权限' }, { status: 404 });
  }

  // ==============================================
  // 6. 取出最后一条用户消息
  // ==============================================
  const lastMessage = messages[messages.length - 1];
  const latestUserMessage =
    lastMessage?.role === 'user' && typeof lastMessage.content === 'string'
      ? lastMessage.content.trim()
      : '';

  if (!latestUserMessage) {
    return Response.json({ message: '最后一条消息必须是用户消息' }, { status: 400 });
  }

  // ==============================================
  // 7. 如果是新对话，自动生成标题
  // ==============================================
  const titleToSave =
    conversation.title === '新对话' ? buildConversationTitle(latestUserMessage) : conversation.title;

  // ==============================================
  // 8. 数据库事务：保存用户消息 + 更新对话标题/时间
  // ==============================================
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
  let messagesWithSearch: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages];
  if (enableSearch) {
    // ==============================================
    // ✅ 9. 执行联网搜索（核心新增）
    // ==============================================
    const searchResults = await tavilySearch(latestUserMessage);
    // ==============================================
    // ✅ 10. 构造带搜索结果的新消息数组
    // ==============================================

    if (searchResults && searchResults.length > 0) {
      // 拼接搜索内容
      const searchContext = searchResults
        .map(
          (item: any, i: number) =>
            `[搜索结果${i + 1}] ${item.title}\n内容：${item.content}\n来源：${item.url}`
        )
        .join('\n\n');

      // 构建增强的用户问题（把搜索结果塞进去）
      const enhancedUserMessage: OpenAI.Chat.ChatCompletionMessageParam = {
        role: 'user',
        content: `
用户问题：${latestUserMessage}

---
以下是联网搜索到的实时信息，请基于这些信息回答：
${searchContext}
---

请直接回答，不要编造信息。
      `.trim(),
      };

      // 替换最后一条用户消息为增强版
      messagesWithSearch = messagesWithSearch.slice(0, -1);
      messagesWithSearch.push(enhancedUserMessage);
    }
  }
  // ==============================================
  // 11. 读取对应服务商的 API Key
  // ==============================================
  const cfg = PROVIDER_CONFIG[provider];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    return Response.json(
      { message: `未配置环境变量 ${cfg.apiKeyEnv}，无法使用该模型` },
      { status: 503 }
    );
  }

  // ==============================================
  // 12. 创建 OpenAI 格式客户端（兼容国内大模型）
  // ==============================================
  const client = new OpenAI({
    apiKey,
    baseURL: cfg.baseURL,
  });

  // ==============================================
  // 13. 调用 AI 流式生成回答（使用带搜索的 messages）
  // ==============================================
  const stream = await client.chat.completions.create({
    model: cfg.model,
    messages: messagesWithSearch, // ✅ 使用增强后的消息
    stream: true,
    temperature: 0.7,
  });

  // ==============================================
  // 14. 把流式 chunk 转成前端可接收的流
  // ==============================================
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

        // 保存 AI 回答
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
              data: { updatedAt: new Date() },
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