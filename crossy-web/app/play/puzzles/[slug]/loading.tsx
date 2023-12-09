import { Button, Heading } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Image from 'next/image'
import { redirect } from 'next/navigation'

import { type CrosswordData } from '@/components/crosswordGridDisplay'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import PuzzleContent from './puzzleContent'

const Loading = ({ params }: { params: { slug: string } }) => {
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  let content

  content = (
    <div className="flex flex-col h-full gap-4 py-5">
      <Heading className="font-serif">Loading...</Heading>
      <div className="flex items-center justify-center flex-1 w-full h-full">
        <PuzzleContent
          crosswordData={{
            grid: [],
            gridnums: [],
            size: {
              cols: 15,
              rows: 15,
            },
          }}
        />
      </div>
      <form className="flex justify-end w-full">
        <Button disabled>Start a game</Button>
      </form>
    </div>
  )
  return <div className="h-full px-6">{content}</div>
}

export default Loading
