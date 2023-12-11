import React from 'react'
import { cookies } from 'next/headers'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import Games from './games'

const Page = async () => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const { data, error } = await supabase
    .from('games')
    .select('*, puzzle_id(name), game_user(user_id), status_of_game(status)')

  if (!data || error) return null

  return (
    <div className="flex flex-col h-full py-5">
      <Games games={data} />
    </div>
  )
}

export default Page
