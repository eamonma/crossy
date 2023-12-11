import { ArrowRightIcon } from '@radix-ui/react-icons'
import { Button } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import MainThemeSwitcher from './mainThemeSwitcher'

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
    <div>
      <main className="flex flex-col min-h-screen bg-gray-50">
        <div className="p-4 pb-0">
          <header className="flex items-center justify-between h-12 px-5 border border-gray-300 rounded-md bg-gray-25">
            <h1 className="font-serif text-lg font-bold">Crossy</h1>
            <div className="flex items-center gap-4 font-medium">
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
              <MainThemeSwitcher />
            </div>
          </header>
        </div>
        <div className="flex items-stretch flex-1 h-full p-4">
          <div className="flex items-center justify-center w-full border border-gray-300 rounded-md shadow-lg bg-gray-25">
            <div className="flex flex-col items-start max-w-md gap-4 px-4">
              <h2 className="font-serif text-4xl leading-8">
                Solve crosswords collaboratively.
              </h2>
              <Button asChild variant="solid">
                <Link href="/play">
                  Continue <ArrowRightIcon />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
