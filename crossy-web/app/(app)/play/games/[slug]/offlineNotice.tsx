'use client'
import React from 'react'
import { Heading } from '@radix-ui/themes'

import useSSRNetworkState from './useSSRNetworkState'

const OfflineNotice = () => {
  const isOnline = useSSRNetworkState()
  if (isOnline) return null

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center w-full h-full p-4 rounded-md bg-gray-50">
      <div className="flex flex-col items-center gap-2">
        <Heading>You're offline!</Heading>
        <p className="font-medium">
          Connect to the Internet to continue playing.
        </p>
      </div>
    </div>
  )
}

export default OfflineNotice
