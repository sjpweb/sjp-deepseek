import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. 并行获取 session 和 params（提速点 1）
    const [session, { id }] = await Promise.all([
      getServerSession(authOptions),
      params
    ]);

    const email = session?.user?.email?.trim().toLowerCase();
    if (!email) {
      return Response.json({ message: '未登录或登录已失效' }, { status: 401 });
    }

    // 2. 一次查询搞定：用户 + 会话权限校验（核心提速！从3次查询 → 1次）
    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        user: { email } // 直接通过关联查询，不用单独查user
      },
      select: { id: true }
    });

    if (!conversation) {
      return Response.json({ message: '会话不存在或无权限' }, { status: 404 });
    }

    // 3. 查询消息（唯一一次必要查询）
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId: id },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        provider: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return Response.json({ messages });

  } catch (error) {
    console.error('[GET_MESSAGES]', error);
    return Response.json({ message: '服务异常' }, { status: 500 });
  }
}