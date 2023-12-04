import { ArrowRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { createClient } from '@/utils/supabase/server'

export default async function Index() {
  const cookieStore = cookies()
  const client = createClient(cookieStore)

  // const canInitSupabaseClient = () => {
  //   // This function is just for the interactive tutorial.
  //   // Feel free to remove it once you have Supabase connected.
  //   try {
  //     createClient(cookieStore);
  //     return true;
  //   } catch (e) {
  //     return false;
  //   }
  // };

  // const isSupabaseConnected = canInitSupabaseClient();

  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  return (
    <main className="min-h-screen flex flex-col">
      <header className="h-12 items-center px-5 border-b border-grayA-5 flex justify-between">
        <h1 className="font-serif text-xl">Crossy</h1>
        <div className="flex items-center gap-4">
          {user && <>Welcome, {user.user_metadata?.full_name}!</>}
          <Button asChild variant="classic" radius="large">
            <a
              target="_blank"
              rel="noreferrer noopener"
              href="https://discord.com/api/oauth2/authorize?client_id=1179137043138355200&permissions=2147534912&scope=bot"
            >
              Invite Crossy to Discord <ArrowRightIcon />
            </a>
          </Button>
        </div>
      </header>
      <div className="h-full flex justify-center items-center flex-1">
        <div className="max-w-md text-black/70 flex items-start gap-4 flex-col">
          <h2 className="text-8 leading-8 font-serif">
            Solve crosswords collaboratively.
          </h2>
          <Button asChild variant="solid" radius="large">
            <Link href="/play">
              Solve online <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </div>
    </main>
  )
}
