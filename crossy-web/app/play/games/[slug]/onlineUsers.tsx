import { Database } from '@/lib/database.types'
import { createClient } from '@/utils/supabase/client'
import { Avatar, Box, Flex, Tooltip, Text } from '@radix-ui/themes'
import { User } from '@supabase/supabase-js'
import React from 'react'
import { useEffect, useState } from 'react'

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

        if (error) throw error

        setUsers(data)
        console.log(data)
      } catch (error) {
        console.log(error)
      }
    }

    fetchUsers()
  }, [userIds])

  const avatars = users.map((user) => {
    return (
      <Tooltip key={user.id} content={user.full_name ?? 'unknown'}>
        {user.avatar_url ? (
          <Avatar size="1" radius="full" src={user.avatar_url} fallback="" />
        ) : (
          <Box className="flex items-center justify-center w-6 h-6 rounded-[999px] bg-gray-5">
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
