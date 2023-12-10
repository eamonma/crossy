'use client'
import React, { useMemo } from 'react'
import { ArrowRightIcon, CookieIcon } from '@radix-ui/react-icons'
import { Link as RadixLink, Table, Text } from '@radix-ui/themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { type Database } from '@/lib/database.types'

type Props = {
  games: Array<Database['public']['Tables']['games']['Row']>
}

const Games: React.FC<Props> = ({ games }) => {
  const router = useRouter()

  const sortedGames = useMemo(() => {
    return [...games].sort((a, b) => {
      return b.created_at.localeCompare(a.created_at)
    })
  }, [games])

  return (
    <>
      <hr className="relative mt-2 border-dashed" />
      <Table.Root className={`w-full ${games.length > 0 && 'h-full'}`} size="3">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Participants</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Started</Table.ColumnHeaderCell>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sortedGames?.map((game) => {
            const gameUrl = `/play/games/${game.id}`
            const puzzle =
              game.puzzle_id as unknown as Database['public']['Tables']['puzzles']['Row']
            const nPlayers = (game as any).game_user.length + 1
            return (
              <Table.Row
                role="link"
                onMouseOver={() => {
                  router.prefetch(gameUrl)
                }}
                onClick={() => {
                  router.push(gameUrl)
                }}
                className="cursor-pointer hover:bg-gray-100"
                key={game.id}
              >
                <Table.RowHeaderCell>
                  <span className="truncate">{puzzle.name}</span>
                </Table.RowHeaderCell>
                <Table.Cell>{nPlayers}</Table.Cell>
                <Table.Cell>
                  {new Date(game.created_at).toLocaleDateString()}
                </Table.Cell>
              </Table.Row>
            )
          })}
        </Table.Body>
      </Table.Root>

      {games.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 w-full gap-2 p-4 py-8">
          <CookieIcon width={42} height={42} />
          <div className="flex gap-2">
            <Text className="text-gray-900">No games yet!</Text>
            <RadixLink asChild>
              <Link href="/play/puzzles" className="flex items-center gap-2">
                Start a game from a puzzle <ArrowRightIcon />
              </Link>
            </RadixLink>
          </div>
        </div>
      )}
    </>
  )
}

export default Games
