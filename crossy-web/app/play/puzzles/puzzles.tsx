'use client'
import React from 'react'
import { Cross1Icon } from '@radix-ui/react-icons'
import { Button, Table } from '@radix-ui/themes'
import Link from 'next/link'

import { type Database } from '@/lib/database.types'

type Props = {
  puzzles: Array<Database['public']['Tables']['puzzles']['Row']>
}

const Puzzles: React.FC<Props> = ({ puzzles }) => {
  return (
    <Table.Root className="w-full">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
          {/* <Table.ColumnHeaderCell>Email</Table.ColumnHeaderCell> */}
          <Table.ColumnHeaderCell>Size</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell></Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {puzzles?.map((puzzle) => {
          return (
            <Table.Row key={puzzle.id}>
              <Table.RowHeaderCell>
                <span className="truncate">{puzzle.name}</span>
              </Table.RowHeaderCell>
              {/* <Table.Cell>danilo@example.com</Table.Cell> */}
              <Table.Cell className="flex items-baseline">
                {puzzle.rows} <Cross1Icon height={10} /> {puzzle.cols}
              </Table.Cell>
              <Table.Cell className="">
                <Button asChild variant="ghost">
                  <Link href={`/play/puzzles/${puzzle.id}`}>Play</Link>
                </Button>
              </Table.Cell>
            </Table.Row>
          )
        })}
      </Table.Body>
    </Table.Root>
  )
}

export default Puzzles
