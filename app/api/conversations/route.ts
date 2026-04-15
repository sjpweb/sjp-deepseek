import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

export async function POST() {
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
