import React from 'react'
import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Puzzles from './puzzles'

const Page = async () => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const { data } = await supabase.from('puzzles').select('*')

  if (!data) return null

  return (
    <div className="">
      <Puzzles puzzles={data} />
    </div>
  )
}

export default Page
export const dynamic = 'force-dynamic'
export const revalidate = 0
