import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, { params }: { params: Promise<{ id: string; }> }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  const { id } = await params;
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

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!conversation) {
    return Response.json({ message: '会话不存在或无权限' }, { status: 404 });
  }

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
}
