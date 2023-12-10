import { ArrowRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

export default async function Index() {
  const cookieStore = cookies()
  const client = createClient<Database>(cookieStore)

  const {
    data: { user },
  } = await client.auth.getUser()

  // get profile
  let profile

  if (user) {
    const { data } = await client
      .from('profiles')
      .select('*')
      .eq('id', user?.id)
      .single()
    profile = data
  }

  return (
    <main className="flex flex-col min-h-screen">
      <header className="flex items-center justify-between h-12 px-5 border-b border-grayA-5">
        <h1 className="font-serif font-bold text-4">Crossy</h1>
        <div className="flex items-center gap-4">
          {user && <>Welcome, {profile?.full_name}!</>}
          {/* <Button asChild variant="classic" radius="large">
            <a
              target="_blank"
              rel="noreferrer noopener"
              href="https://discord.com/api/oauth2/authorize?client_id=1179137043138355200&permissions=2147534912&scope=bot"
            >
              Invite Crossy to Discord <ArrowRightIcon />
            </a>
          </Button> */}
        </div>
      </header>
      <div className="flex items-center justify-center flex-1 h-full">
        <div className="flex flex-col items-start max-w-md gap-4 px-4 text-black/70">
          <h2 className="font-serif leading-8 text-8">
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
