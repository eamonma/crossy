import React from 'react'
import { cookies } from 'next/headers'

import { createClient } from '@/utils/supabase/server'

const Page = async () => {
  const cookieStore = cookies()
  const supabase = createClient(cookieStore)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="h-full overflow-auto">
      <pre>{JSON.stringify(user, null, 2)}</pre>
    </div>
  )
}

export default Page
