'use client'
import React, { useEffect, useState } from 'react'
import {
  HamburgerMenuIcon,
} from '@radix-ui/react-icons'
import { DropdownMenu, IconButton } from '@radix-ui/themes'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'

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
  }

  const [mounted, setMounted] = useState(false)
  const { theme, setTheme } = useTheme()

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  const handleThemeChange = (value: typeof theme) => {
    if (!value) return
    setTheme(value)
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <IconButton variant="ghost">
          <HamburgerMenuIcon />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.RadioGroup
          value={theme}
          onValueChange={handleThemeChange}
        >
          <DropdownMenu.RadioItem
            value="system"
            className="flex justify-between"
          >
            System
          </DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="light">Light</DropdownMenu.RadioItem>
          <DropdownMenu.RadioItem value="dark">Dark</DropdownMenu.RadioItem>
        </DropdownMenu.RadioGroup>
        <DropdownMenu.Separator />
        {isLoggedIn ? (
          <DropdownMenu.Item asChild color="red">
            <button onClick={logout}>Logout</button>
          </DropdownMenu.Item>
        ) : (
          <DropdownMenu.Item asChild>
            <Link href="/login">Sign in</Link>
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export default MainThemeSwitcher
