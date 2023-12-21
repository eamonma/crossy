'use client'
import React, { useCallback, useEffect, useState } from 'react'
import { Button, Dialog, Flex, Text, TextField } from '@radix-ui/themes'
import { type Session } from '@supabase/supabase-js'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

type Props = {
  session: Session | null
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  onUpdateProfile: () => void
}

const AccountForm: React.FC<Props> = ({
  session,
  setOpen,
  onUpdateProfile,
}) => {
  const supabase = createClient<Database>()
  const [loading, setLoading] = useState(true)
  const [fullname, setFullname] = useState<string | null>(null)
  const user = session?.user

  void loading

  const getProfile = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)

      const { data, error, status } = await supabase
        .from('profiles')
        .select('full_name, username, avatar_url')
        .eq('id', user.id)
        .single()

      if (error && status !== 406) {
        throw Error(error.message)
      }

      if (data) {
        setFullname(data.full_name)
      }
    } catch (error) {
    } finally {
      setLoading(false)
    }
  }, [user, supabase])

  useEffect(() => {
    void getProfile()
  }, [getProfile])

  async function handleUpdateProfile() {
    try {
      setLoading(true)

      const { error } = await supabase.from('profiles').upsert({
        id: user?.id as string,
        full_name: fullname,
        updated_at: new Date().toISOString(),
      })
      if (error) throw Error(error.message)
      setOpen(false)
      onUpdateProfile()
    } catch (error) {
      console.log(error)

      alert('Error updating the data!')
    } finally {
      setLoading(false)
    }
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    await handleUpdateProfile()
  }

  return (
    <Dialog.Content style={{ maxWidth: 450 }}>
      <Dialog.Title>Edit profile</Dialog.Title>
      <Dialog.Description size="2" mb="4">
        Make changes to your profile.
      </Dialog.Description>

      <form onSubmit={onSubmit}>
        <Flex direction="column" gap="3">
          <label>
            <Text as="div" size="2" mb="1" weight="bold">
              Email
            </Text>
            <TextField.Input
              id="email"
              type="text"
              value={user?.email}
              disabled
            />
          </label>
          <label>
            <Text as="div" size="2" mb="1" weight="bold">
              Name
            </Text>
            <TextField.Input
              id="fullName"
              type="text"
              value={fullname ?? ''}
              onChange={(e) => {
                setFullname(e.target.value)
              }}
            />
          </label>
        </Flex>

        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft">Cancel</Button>
          </Dialog.Close>
          <Dialog.Close>
            <Button type="submit">Save</Button>
          </Dialog.Close>
        </Flex>
      </form>
    </Dialog.Content>
  )
}
export default AccountForm
