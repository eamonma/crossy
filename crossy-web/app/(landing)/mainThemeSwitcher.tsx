'use client'
import React from 'react'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import { DropdownMenu, IconButton } from '@radix-ui/themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import ThemeSwitcher from '@/components/themeSwitcher'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

type Props = {
  isLoggedIn: boolean
}

const MainThemeSwitcher: React.FC<Props> = ({ isLoggedIn }) => {
  const supabase = createClient<Database>()
  const router = useRouter()

  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.log(error)
    }
    router.push('/login')
    router.refresh()
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton variant="ghost">
          <HamburgerMenuIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        {isLoggedIn ? (
          <>
            <DropdownMenu.Item asChild>
              <Link href="/play">Games</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link href="/play/puzzles">Puzzles</Link>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item asChild color="red">
              <button onClick={logout}>Logout</button>
            </DropdownMenu.Item>
          </>
        ) : (
          <DropdownMenu.Item asChild>
            <Link href="/login">Sign in</Link>
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item asChild>
          <Link href="/privacy">Privacy policy</Link>
        </DropdownMenu.Item>
        <DropdownMenu.Item asChild>
          <Link href="/terms">Terms of use</Link>
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <ThemeSwitcher />
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export default MainThemeSwitcher
