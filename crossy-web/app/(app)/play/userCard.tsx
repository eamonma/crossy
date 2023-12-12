'use client'
import { useCallback, useEffect, useState } from 'react'
import { HamburgerMenuIcon } from '@radix-ui/react-icons'
import {
  Avatar,
  Box,
  Card,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  Text,
} from '@radix-ui/themes'
import { type Session } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

import ThemeSwitcher from '@/components/themeSwitcher'
import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

import AccountForm from './profile/accountModal'

const UserCard = ({ session }: { session: Session }) => {
  const supabase = createClient<Database>()
  const user = session?.user
  const router = useRouter()

  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.log(error)
    }
    router.push('/login')
  }

  const [profile, setProfile] =
    useState<Database['public']['Tables']['profiles']['Row']>()

  const getProfile = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .eq('id', user?.id)
      .single()
    if (error) {
      console.log(error)
    }

    if (!data) return
    setProfile(data as any)
  }, [supabase, user?.id])

  useEffect(() => {
    void getProfile()
  }, [getProfile])

  const [open, setOpen] = useState(false)

  return (
    <Card>
      <div className="flex items-center justify-between w-full">
        <Flex gap="2" align="center" className="overflow-hidden">
          <Avatar
            size="3"
            src={profile?.avatar_url ?? ''}
            radius="full"
            fallback={profile?.full_name?.charAt(0) ?? ''}
          />
          <Box className="min-w-0">
            <Text className="min-w-0 truncate" as="div" size="2" weight="bold">
              {profile?.full_name}
            </Text>
          </Box>
        </Flex>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton variant="ghost">
              <HamburgerMenuIcon />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            <ThemeSwitcher />

            <DropdownMenu.Item asChild>
              <button
                onClick={() => {
                  setOpen(true)
                }}
              >
                Edit profile
              </button>
            </DropdownMenu.Item>

            <DropdownMenu.Separator />
            <DropdownMenu.Item asChild color="red">
              <button onClick={logout}>Logout</button>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <Dialog.Root
          open={open}
          onOpenChange={(n) => {
            setOpen(n)
          }}
        >
          <AccountForm
            session={session}
            setOpen={setOpen}
            onUpdateProfile={getProfile}
          />
        </Dialog.Root>
      </div>
    </Card>
  )
}

export default UserCard
