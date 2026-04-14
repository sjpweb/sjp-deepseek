import { hash } from 'bcryptjs';
import { prisma } from '@/lib/prisma';

type RegisterBody = {
  email?: string;
  password?: string;
  name?: string;
};

export async function POST(req: Request) {
  let body: RegisterBody;

  try {
    body = (await req.json()) as RegisterBody;
  } catch {
    return Response.json({ message: '请求体格式错误' }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();
  const name = body.name?.trim() || null;

  if (!email || !password) {
    return Response.json({ message: '邮箱和密码不能为空' }, { status: 400 });
  }

  if (password.length < 6) {
    return Response.json({ message: '密码长度至少 6 位' }, { status: 400 });
  }

  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (exists) {
    return Response.json({ message: '该邮箱已注册' }, { status: 409 });
  }

  const passwordHash = await hash(password, 10);

  await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
    },
  });

  return Response.json({ message: '注册成功' }, { status: 201 });
}
