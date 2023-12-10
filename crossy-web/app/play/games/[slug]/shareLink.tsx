'use client'
import React, { useEffect, useState } from 'react'
import { ExternalLinkIcon } from '@radix-ui/react-icons'
import {
  Button,
  Flex,
  Heading,
  Popover,
  Text,
  TextField,
} from '@radix-ui/themes'
import { useCopyToClipboard } from 'usehooks-ts'

import { type Database } from '@/lib/database.types'

type Props = {
  game: Database['public']['Tables']['games']['Row']
}

const ShareLink: React.FC<Props> = ({ game }) => {
  const [, copy] = useCopyToClipboard()
  const [link, setLink] = useState('')

  useEffect(() => {
    setLink(
      `${window.location.origin}/play/games/${game.id}?key=${game.password}`,
    )
  }, [game])

  const copyInvite = async () => {
    await copy(link)
  }

  return (
    <>
      <Popover.Root>
        <Popover.Trigger>
          <Button variant="ghost">
            <ExternalLinkIcon />
            Share
          </Button>
        </Popover.Trigger>
        <Popover.Content align="end">
          <Flex direction="column">
            <Heading size="5">Share link</Heading>
            <Text size="2" mb="4" mt="2">
              Anyone with this link can join the game.
            </Text>

            <Flex direction="column" gap="3">
              <label>
                <p className="sr-only">Link</p>
                <TextField.Input
                  value={link}
                  disabled
                  className="w-full p-1 pl-1 pr-0 border border-gray-6 text-2"
                />
              </label>
            </Flex>

            <Flex gap="3" mt="4" justify="end">
              <Popover.Close>
                <Button variant="outline" onClick={copyInvite}>
                  Copy and close
                </Button>
              </Popover.Close>
            </Flex>
          </Flex>
        </Popover.Content>
      </Popover.Root>
    </>
  )
}

export default ShareLink
