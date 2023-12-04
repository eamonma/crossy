'use client'
import React, { useState } from 'react'
import {
  ChevronLeftIcon,
  DiscordLogoIcon,
  ExternalLinkIcon,
  FileIcon,
  HomeIcon,
} from '@radix-ui/react-icons'
import { IconButton, Link as RadixLink } from '@radix-ui/themes'
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
  type: 'easeInOut',
  duration: 0.2,
}

const AppLayout: React.FC<Props> = ({ session, children }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(true)
  return (
    <div className="bg-gray-3 w-full">
      <nav className="w-64 flex h-full flex-col p-6 pb-4 pr-2 gap-4 justify-between">
        <ul className="flex gap-4 flex-col">
          <h1 className="text-center text-4 font-serif font-medium">Crossy</h1>
          <hr className="border-dashed border-grayA-5" />
          <li>
            <Link
              underline="auto"
              href="/play"
              className="flex items-center gap-2"
            >
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
        <UserCard session={session} />
      </nav>
      <motion.div
        initial={false}
        animate={{
          marginLeft: isMenuOpen ? '17rem' : '1rem',
          width: isMenuOpen ? 'calc(100vw - 18rem)' : 'calc(100vw - 2rem)',
        }}
        transition={{
          duration: 0.2,
        }}
        className="z-10 flex-1 h-[calc(100vh-2rem)] absolute inset-y-0  transition shadow-3 rounded-4 m-4 w-full bg-gray-1"
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
          </motion.div>
        </div>
        <div className="h-full overflow-auto py-5">{children}</div>
      </motion.div>
    </div>
  )
}

export default AppLayout
