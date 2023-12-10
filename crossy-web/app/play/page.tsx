import React from 'react'
import { Heading } from '@radix-ui/themes'
import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Games from './games'

const Page = async () => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const { data, error } = await supabase
    .from('games')
    .select('*, puzzle_id(name), game_user(user_id)')

  if (!data || error) return null

  return (
    <div className="flex flex-col h-full py-5">
      <Heading className="flex px-5">Games</Heading>
      <Games games={data} />
    </div>
  )
}

export default Page
