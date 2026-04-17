import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type ActionBody = {
  action?: string
  id?: string
};

export async function GET() {
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

  const conversations = await prisma.conversation.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: {
        select: { messages: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return Response.json({ conversations });
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
