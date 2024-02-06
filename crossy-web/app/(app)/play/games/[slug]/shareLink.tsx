'use client'
import React, { useEffect, useState } from 'react'
import Skeleton from 'react-loading-skeleton'
import { ExternalLinkIcon } from '@radix-ui/react-icons'
import {
  Button,
  Popover,
  TextField,
} from '@radix-ui/themes'
import { useCopyToClipboard } from 'usehooks-ts'

import { type Database } from '@/lib/database.types'

import 'react-loading-skeleton/dist/skeleton.css'

type Props = {
  game: Database['public']['Tables']['games']['Row']
}

const ShareLink: React.FC<Props> = ({ game }) => {
  const [, copy] = useCopyToClipboard()
  const [link, setLink] = useState('')

  useEffect(() => {
    const canonicalLink = `${window.location.origin}/play/games/${game.id}?key=${game.password}`

    const baseUrl = '/api/games/get-share-link'

    const params = {
      url: canonicalLink,
    }

    fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
      .then(async (response) => await response.json())
      .then(
        (data) => {
          setLink(data.data)
        },
        (error) => {
          console.log(error)
          setLink(canonicalLink)
        },
      )
  }, [game])

  const copyInvite = async () => {
    await copy(link)
  }

  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="soft">
          <ExternalLinkIcon />
          Share
        </Button>
      </Popover.Trigger>
      <Popover.Content align="end" size="2" className="max-w-xs">
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Anyone with this link can join or invite others to join.
          </p>

          {link !== '' ? (
            <label>
              <p className="sr-only">Link</p>
              <TextField.Input
                value={link.split('https://')[1]}
                onClick={(e) => e.currentTarget.select()}
                onCopy={(e) => {
                  // prepend https:// to the copied link
                  e.clipboardData.setData('text/plain', link)
                  e.preventDefault()
                }}
                className="w-full p-1 pl-1 pr-0"
              />
            </label>
          ) : (
            <Skeleton className="flex-1 h-8 p-1" />
          )}

          <div className="flex justify-end">
            <Popover.Close>
              <Button onClick={copyInvite}>Copy and close</Button>
            </Popover.Close>
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}

export default ShareLink
