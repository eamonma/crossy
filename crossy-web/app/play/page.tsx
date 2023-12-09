import React from 'react'
import { Card, Grid, Heading, Text } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Link from 'next/link'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

const Page = async () => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const { data, error } = await supabase
    .from('games')
    .select('*, puzzle_id(name)')

  if (!data || error) return null

  return (
    <div className="flex flex-col gap-4 p-5">
      <Heading>My games</Heading>
      <Grid columns="2" gap="2">
        {data.map((game) => {
          const puzzle: Database['public']['Tables']['games']['Row'] =
            game.puzzle_id as any

          return (
            <Card key={game.id} asChild size="3">
              <Link href={`/play/games/${game.id}`}>
                <Text weight="medium" size="3">
                  {puzzle.name}
                </Text>
              </Link>
            </Card>
          )
        })}
      </Grid>
    </div>
  )
}

export default Page
