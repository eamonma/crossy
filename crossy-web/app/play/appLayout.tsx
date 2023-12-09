'use client'
import React, { useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import {
  ChevronLeftIcon,
  Cross1Icon,
  Cross2Icon,
  Crosshair1Icon,
  Crosshair2Icon,
  DiscordLogoIcon,
  ExternalLinkIcon,
  FileIcon,
  HomeIcon,
} from '@radix-ui/react-icons'
import { IconButton, Link as RadixLink, Tooltip } from '@radix-ui/themes'
import { type Session } from '@supabase/supabase-js'
import { motion, type Transition } from 'framer-motion'

import Link from './activeLink'
import CreatePuzzle from './createPuzzle'
import UserCard from './userCard'

type Props = {
  children: React.ReactNode
  session: Session
}

const transition: Transition = {
  ease: 'easeInOut',
  duration: 0.2,
}

const AppLayout: React.FC<Props> = ({ session, children }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(true)
  useHotkeys(
    'meta+shift+s, ctrl+shift+s',
    (e) => {
      e.preventDefault()
      setIsMenuOpen((prev) => !prev)
    },
    [isMenuOpen, setIsMenuOpen],
  )

  return (
    <div className="w-full bg-gray-3">
      <nav className="flex flex-col justify-between w-64 h-full gap-4 p-4 pr-0">
        <ul className="flex flex-col gap-4 px-2">
          <h1 className="flex items-center justify-center gap-1 mt-2 -mb-2 font-serif font-bold text-center">
            <Crosshair2Icon />
            Crossy
          </h1>
          <hr className="border-dashed border-grayA-5" />
          <li>
            <Link href="/play" className="flex items-center gap-2">
              <HomeIcon />
              Home
            </Link>
          </li>
          <li>
            <Link href="/play/puzzles" className="flex items-center gap-2">
              <FileIcon />
              My puzzles
            </Link>
          </li>
          <li>
            <CreatePuzzle />
          </li>
          <hr className="border-dashed border-grayA-5" />
          <li>
            <RadixLink asChild>
              <a
                target="_blank"
                rel="noreferrer noopener"
                href="https://discord.com/api/oauth2/authorize?client_id=1179137043138355200&permissions=2147534912&scope=bot"
                className="flex items-center gap-2"
              >
                <DiscordLogoIcon />
                Invite Bot
                <ExternalLinkIcon />
              </a>
            </RadixLink>
          </li>
          <hr className="border-dashed border-grayA-5" />
        </ul>
        <div>
          <UserCard session={session} />
        </div>
      </nav>
      <motion.div
        initial={false}
        animate={{
          marginLeft: isMenuOpen ? '17rem' : '1rem',
          width: isMenuOpen ? 'calc(100vw - 18rem)' : 'calc(100vw - 2rem)',
        }}
        transition={transition}
        className="z-10 flex-1 h-[calc(100vh-2rem)] absolute inset-y-0 shadow-3 rounded-4 m-4 w-full bg-gray-1"
      >
        <div className="absolute inset-y-0 z-10 top-1/2">
          <motion.div
            initial={false}
            className="absolute"
            animate={{
              left: isMenuOpen ? '-1rem' : '1rem',
            }}
            transition={transition}
          >
            <Tooltip content={'⌘+shift+s'}>
              <IconButton
                size="4"
                variant="ghost"
                radius="full"
                onClick={() => {
                  setIsMenuOpen((prev) => !prev)
                }}
                className="absolute"
              >
                <motion.div
                  animate={{
                    rotate: isMenuOpen ? 0 : 180,
                  }}
                  transition={transition}
                  className="absolute p-2"
                >
                  <ChevronLeftIcon height={18} width={18} />
                </motion.div>
              </IconButton>
            </Tooltip>
          </motion.div>
        </div>
        <div className="h-full overflow-auto">{children}</div>
      </motion.div>
    </div>
  )
}

export default AppLayout
