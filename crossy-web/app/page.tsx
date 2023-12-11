import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Hero from './hero'
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

  const timeOfDay = new Date().getHours()
  let timeGreeting
  if (timeOfDay < 4) {
    timeGreeting = 'Good night'
  } else if (timeOfDay < 12) {
    timeGreeting = 'Good morning'
  } else if (timeOfDay < 18) {
    timeGreeting = 'Good afternoon'
  } else {
    timeGreeting = 'Good evening'
  }

  return (
    <div>
      <main className="flex flex-col min-h-screen bg-gray-50">
        <div className="p-4 pb-0">
          <header className="flex items-center justify-between h-12 px-5 border border-gray-300 rounded-md bg-gray-25">
            <h1 className="font-serif text-lg font-bold">Crossy</h1>
            <div className="flex items-center gap-4 font-medium">
              {user && (
                <>
                  {timeGreeting}
                  {', '}
                  {profile?.full_name ?? user.email}
                </>
              )}

              <MainThemeSwitcher isLoggedIn={Boolean(user)} />
            </div>
          </header>
        </div>
        <div className="flex items-stretch flex-1 h-full p-4">
          <Hero isLoggedIn={Boolean(user)} />
        </div>
      </main>
    </div>
  )
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
