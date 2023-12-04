'use client'

import { useEffect, useState } from 'react'

import { createClient } from '@/utils/supabase/client'

const UserInfo = () => {
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const getUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      setUser(user)
    }
    getUser()
  })
  return <pre>{JSON.stringify(user)}</pre>
}

export default UserInfo
