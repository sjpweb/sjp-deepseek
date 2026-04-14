import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import Chat from '@/app/page/chat';
import { authOptions } from '@/lib/auth';

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect('/login');
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <Chat />
    </div>
  );
}
