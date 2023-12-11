'use client'
import React, { useEffect, useState } from 'react'
import { MoonIcon } from '@radix-ui/react-icons'
import { DropdownMenu, IconButton } from '@radix-ui/themes'
import { useTheme } from 'next-themes'

const MainThemeSwitcher = () => {
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
          <MoonIcon />
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
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

export default MainThemeSwitcher
