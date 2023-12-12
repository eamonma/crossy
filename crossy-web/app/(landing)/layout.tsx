import { cookies } from 'next/headers'
import Link from 'next/link'

import CrossyLogo from '@/components/crossyLogo'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Greeting from '../greeting'

import MainThemeSwitcher from './mainThemeSwitcher'

type Props = {
  children: React.ReactNode
}

const Layout: React.FC<Props> = async ({ children }) => {
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
            <Link href="/">
              <h1 className="flex items-center gap-1 font-serif text-lg font-bold">
                <div className="w-6 h-6 text-white rounded-full bg-gold-800 p-0.5">
                  <CrossyLogo />
                </div>
                Crossy
              </h1>
            </Link>

            <div className="flex items-center gap-4 font-medium">
              {user && (
                <>
                  <Greeting name={profile?.full_name ?? user.email} />
                </>
              )}

              <MainThemeSwitcher isLoggedIn={Boolean(user)} />
            </div>
          </header>
        </div>
        <div className="relative flex flex-1 w-full h-full p-4">{children}</div>
      </main>
    </div>
  )
}

export default Layout
export const revalidate = 0
export const dynamic = 'force-dynamic'
