import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Hero from '../hero'

export default async function Index() {
  const cookieStore = cookies()
  const client = createClient<Database>(cookieStore)

  const {
    data: { user },
  } = await client.auth.getUser()

  return (
    <div className="relative flex flex-col w-full">
      <Hero isLoggedIn={Boolean(user)} />
    </div>
  )
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
