import React, { useEffect, useState } from 'react'
import { Avatar, Box, Flex, Text, Tooltip } from '@radix-ui/themes'

import { type Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'

type Props = {
  userIds: string[]
}

const OnlineUsers: React.FC<Props> = ({ userIds }) => {
  const supabase = createClient<Database>()
  const [users, setUsers] = useState<
    Array<Database['public']['Tables']['profiles']['Row']>
  >([])

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .in('id', userIds)

        if (error) throw Error(error.message)

        setUsers(data)
      } catch (error) {
        console.log(error)
      }
    }

    void fetchUsers().then(() => {})
  }, [supabase, userIds])

  const avatars = users.map((user) => {
    return (
      <Tooltip key={user.id} content={user.full_name ?? 'unknown'}>
        {user.avatar_url ? (
          <Avatar size="1" radius="full" src={user.avatar_url} fallback="" />
        ) : (
          <Box className="flex items-center justify-center w-6 h-6 bg-gray-200 rounded-[999px]">
            <Text size="1" color="gray">
              {user.full_name?.charAt(0).toUpperCase()}
            </Text>
          </Box>
        )}
      </Tooltip>
    )
  })

  return (
    <Flex gap="1" align="center">
      {avatars}
    </Flex>
  )
}

export default OnlineUsers
