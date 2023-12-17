import { type Database } from '@/lib/database.types'
import { dangerouslyCreateServiceRoleClient } from '@/utils/supabase/server'

export async function POST(request: Request): Promise<Response> {
  const req = await request.json()
  const dangerousSupabase = dangerouslyCreateServiceRoleClient<Database>()

  const { data: statusOfGame, error: statusOfGameError } =
    await dangerousSupabase
      .from('status_of_game')
      .select('*')
      .eq('id', req)
      .single()

  if (statusOfGameError) {
    return Response.json({ error: statusOfGameError })
  }

  if (statusOfGame.status !== 'ongoing') {
    return Response.json({ error: 'Game is not ongoing' })
  }

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
    if (puzzle.grid[i] === '') continue
    if (puzzle.grid[i]?.charAt(0) !== grid[i]?.charAt(0)) {
      return Response.json({ error: 'Puzzle is not complete' })
    }
  }

  const { error: updatedGameError } = await dangerousSupabase
    .from('status_of_game')
    .update({ status: 'completed', game_ended_at: new Date().toISOString() })
    .eq('id', req)
    .single()

  if (updatedGameError) {
    return Response.json({ error: updatedGameError })
  }

  return Response.json({ data: 'ok' })
}
