import { cookies } from 'next/headers'
import { z } from 'zod'

import { crosswordJsonSchema } from '@/lib/crosswordJson'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request): Promise<Response> {
  const req = await request.json()
  const cookieStore = cookies()
  const supabase = createClient<Database>(cookieStore)

  const circlesToBoolean = (circles: number[] | null): boolean[] | null => {
    if (circles == null) return null
    return circles.map(Boolean)
  }

  try {
    const res = crosswordJsonSchema.parse(req)

    const circles = circlesToBoolean(res?.circles)
    const { data, error } = await supabase
      .from('puzzles')
      .insert([
        {
          name: res.title,
          cols: res.size.cols,
          rows: res.size.rows,
          grid: res.grid,
          gridnums: res.gridnums,
          clues: res.clues,
          answers: res.answers,
          circles,
        },
      ])
      .select()
      .single()

    if (error) {
      return Response.json({ error })
    }

    return Response.json({ data })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues })
    }
  }

  return Response.json({ res: req })
}
