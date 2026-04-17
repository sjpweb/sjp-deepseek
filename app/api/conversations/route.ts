import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type ActionBody = {
  action?: string
  id?: string
};

// 缓存 getServerSession（非常关键！）
const getSessionCached = async () => {
  return await getServerSession(authOptions);
};

export async function GET() {
  try {
    // 1. 获取会话（并行化空间不大，但必须保证最快）
    const session = await getSessionCached();
    const email = session?.user?.email?.trim().toLowerCase();

    if (!email) {
      return Response.json({ message: "未登录或登录已失效" }, { status: 401 });
    }

    // 2. 合并查询！！！把 user + conversations 一次查完（提速核心）
    const userWithConversations = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        conversations: {
          select: {
            id: true,
            title: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    if (!userWithConversations) {
      return Response.json({ message: "用户不存在" }, { status: 404 });
    }

    return Response.json({
      conversations: userWithConversations.conversations,
    });
  } catch (error) {
    console.error("[CONVERSATION_GET]", error);
    return Response.json({ message: "服务异常" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: ActionBody;

  try {
    body = (await req.json()) as ActionBody;
  } catch {
    return Response.json({ message: '请求体格式错误' }, { status: 400 });
  }
  const action = body.action;
  const id = body.id;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    return Response.json({ message: '未登录或登录已失效' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    return Response.json({ message: '用户不存在' }, { status: 401 });
  }

  if (action === 'create') {
    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: '新对话',
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    return Response.json({ conversation }, { status: 201 });
  }

  if (action === 'delete') {
    // 事务：先删消息，再删会话
    await prisma.$transaction([
      prisma.chatMessage.deleteMany({
        where: { conversationId: id },
      }),
      prisma.conversation.delete({
        where: { id },
      }),
    ]);

    return Response.json({
      message: '会话删除成功',
      success: true
    }, { status: 200 });
  }

}
