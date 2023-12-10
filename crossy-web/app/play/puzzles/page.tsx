import React from 'react'
import { Heading } from '@radix-ui/themes'
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
    <div className="flex flex-col h-full py-5">
      <Heading className="flex px-5">Puzzles</Heading>
      <Puzzles puzzles={data} />
    </div>
  )
}

export default Page
export const dynamic = 'force-dynamic'
export const revalidate = 0
