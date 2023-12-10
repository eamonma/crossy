'use client'
import React, { useEffect, useState } from 'react'
import { DropdownMenu } from '@radix-ui/themes'
import { useTheme } from 'next-themes'

const ThemeSwitcher = () => {
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
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger>Theme</DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent>
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
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  )
}

export default ThemeSwitcher
