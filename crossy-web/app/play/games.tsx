'use client'
import React, { useMemo } from 'react'
import { ArrowRightIcon, CookieIcon } from '@radix-ui/react-icons'
import { Heading, Link as RadixLink, Table, Text } from '@radix-ui/themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { type Database } from '@/lib/database.types'

type Props = {
  games: Array<Database['public']['Tables']['games']['Row']>
}

const Games: React.FC<Props> = ({ games }) => {
  const router = useRouter()

  const ongoingGames = useMemo(() => {
    return [...games]
      .filter((game) => {
        const statusOfGame = (game as any).status_of_game
          .status as Database['public']['Tables']['status_of_game']['Row']['status']
        return statusOfGame === 'ongoing'
      })
      .sort((a, b) => {
        return b.created_at.localeCompare(a.created_at)
      })
  }, [games])

  const completedGames = useMemo(() => {
    return [...games]
      .filter((game) => {
        const statusOfGame = (game as any).status_of_game
          .status as Database['public']['Tables']['status_of_game']['Row']['status']
        return statusOfGame === 'completed'
      })
      .sort((a, b) => {
        return b.created_at.localeCompare(a.created_at)
      })
  }, [games])

  return (
    <>
      <Heading className="flex px-5">Ongoing games</Heading>
      <hr className="relative mt-2 border-dashed" />
      <div className="w-full">
        <Table.Root className="w-full" size="3">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Participants</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Started</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {ongoingGames?.map((game) => {
              const gameUrl = `/play/games/${game.id}`
              const puzzle =
                game.puzzle_id as unknown as Database['public']['Tables']['puzzles']['Row']
              console.log(game)

              const statusOfGame = (game as any).status_of_game
                .status as Database['public']['Tables']['status_of_game']['Row']['status']

              console.log(statusOfGame)

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
                    <span className="flex items-center gap-2 truncate">
                      {puzzle.name}
                    </span>
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
        <div className="pl-5 my-2 mt-6">
          <Heading>Completed games</Heading>
        </div>
        <hr className="relative mt-2 border-dashed" />
        <Table.Root className="w-full" size="3">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Participants</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Started</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {completedGames?.map((game) => {
              const gameUrl = `/play/games/${game.id}`
              const puzzle =
                game.puzzle_id as unknown as Database['public']['Tables']['puzzles']['Row']
              console.log(game)

              const statusOfGame = (game as any).status_of_game
                .status as Database['public']['Tables']['status_of_game']['Row']['status']

              console.log(statusOfGame)

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
                    <span className="flex items-center gap-2 truncate">
                      {puzzle.name}
                    </span>
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
      </div>
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
