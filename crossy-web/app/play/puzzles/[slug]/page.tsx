import { Button, Heading } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Image from 'next/image'
import { redirect } from 'next/navigation'

import { type CrosswordData } from '@/components/crosswordGridDisplay'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

import PuzzleContent from './puzzleContent'

const Page = async ({ params }: { params: { slug: string } }) => {
  const { slug } = params
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  // get puzzle
  const puzzle = await supabase
    .from('puzzles')
    .select('*')
    .eq('id', slug)
    .single()

  const { data, error } = puzzle

  let content

  const createGame = async () => {
    'use server'
    const cookieStore = cookies()
    const supabase = createClient<Database>(cookieStore)

    const { data: gameData, error: gameError } = await supabase
      .from('games')
      .insert([{ puzzle_id: slug }])
      .select()
      .single()

    if (gameData) {
      redirect(`/play/games/${gameData.id}`)
    }
  }

  if (error) {
    content = (
      <div className="h-full relative">
        <div className="flex justify-center items-center absolute inset-0">
          <div className="w-full flex max-w-sm flex-col gap-4 items-center">
            <Image
              src="/404.png"
              alt="404 notice"
              className="object-fit rounded-6 shadow-4"
              height="1024"
              width="1024"
            />
            <Heading size="4">Couldn't find this puzzle!</Heading>
          </div>
        </div>
      </div>
    )
  } else {
    const crosswordData: CrosswordData = {
      ...data,
      size: {
        cols: data.cols,
        rows: data.rows,
      },
    }

    content = (
      <div className="flex flex-col h-full gap-4">
        <Heading className="font-serif">{data.name}</Heading>
        <div className="flex w-full justify-center items-center h-full flex-1">
          <PuzzleContent crosswordData={crosswordData} />
        </div>
        <form action={createGame} className="flex w-full justify-end">
          <Button>Start a game</Button>
        </form>
      </div>
    )
  }

  return <div className="px-6 h-full">{content}</div>
}

export default Page
