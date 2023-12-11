import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

import AppLayout from './appLayout'

export const metadata = {
  title: 'Games',
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode
}) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const user = session?.user

  if (!user) return redirect('/login')

  return (
    <div className="flex-1 w-full flex h-screen">
      <AppLayout session={session}>{children}</AppLayout>
    </div>
  )
}
