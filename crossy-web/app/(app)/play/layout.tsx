import { cookies, headers } from 'next/headers'
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
  searchParams?: Record<string, string | string[] | undefined>
}) {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const pathname = headers().get('x-pathname')

  const {
    data: { session },
  } = await supabase.auth.getSession()

  const user = session?.user

  if (!user) return redirect(`/login${`?redirectTo=${pathname}`}`)

  return (
    <div className="flex flex-1 w-full h-screen">
      <AppLayout session={session}>{children}</AppLayout>
    </div>
  )
}
