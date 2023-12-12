'use client'
import React, { useEffect, useState } from 'react'
import _Confetti from 'react-confetti'
import useWindowSize from 'react-use/lib/useWindowSize'
import { Portal } from '@radix-ui/themes'

// eslint-disable-next-line @typescript-eslint/ban-types
type Props = {} & React.ComponentProps<typeof _Confetti>

const Confetti: React.FC<Props> = (props) => {
  const { width, height } = useWindowSize()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    setIsClient(true)
  }, [])

  return (
    isClient && (
      <Portal>
        <_Confetti
          {...props}
          suppressHydrationWarning
          className="fixed left-0 m-0"
          width={width}
          height={height}
        />
      </Portal>
    )
  )
}

export default Confetti
