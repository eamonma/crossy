import { type Database } from '@/lib/database.types'
import { dangerouslyCreateServiceRoleClient } from '@/utils/supabase/server'

export async function POST(request: Request): Promise<Response> {
  const req = await request.json()
  const dangerousSupabase = dangerouslyCreateServiceRoleClient<Database>()

  const { data: status_of_game, error: status_of_game_error } =
    await dangerousSupabase
      .from('status_of_game')
      .select('*')
      .eq('id', req)
      .single()

  if (status_of_game_error) {
    return Response.json({ error: status_of_game_error })
  }

  if (status_of_game.status !== 'ongoing') {
    return Response.json({ error: 'Game is not ongoing' })
  }

  console.log(status_of_game)
  console.log(status_of_game_error)

  const { data: game, error: gameError } = await dangerousSupabase
    .from('games')
    .select('*, puzzles(*)')
    .eq('id', req)
    .single()

  if (gameError) {
    return Response.json({ error: gameError })
  }

  if (!game?.puzzles) {
    return Response.json({ error: 'Game not found' })
  }

  const puzzle = game.puzzles
  const grid = game.grid

  for (let i = 0; i < puzzle.grid.length; i++) {
    if (puzzle.grid[i] === '.') continue
    if (puzzle.grid[i] !== grid[i]) {
      return Response.json({ error: 'Puzzle is not complete' })
    }
  }

  const { data: updatedGame, error: updatedGameError } = await dangerousSupabase
    .from('status_of_game')
    .update({ status: 'completed', game_ended_at: new Date().toISOString() })
    .eq('id', req)
    .single()

  if (updatedGameError) {
    return Response.json({ error: updatedGameError })
  }

  return Response.json({ data: 'ok' })
}
