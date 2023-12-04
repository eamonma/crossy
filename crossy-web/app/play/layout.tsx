import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

import AppLayout from './appLayout'

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000'

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: 'Crossy',
  description: 'Solve crosswords with friends',
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
