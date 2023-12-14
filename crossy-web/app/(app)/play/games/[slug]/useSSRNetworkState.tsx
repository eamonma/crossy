import { useEffect, useState } from 'react'

const useSSRNetworkState = () => {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    const a = () => {
      setIsOnline(true)
    }
    window.addEventListener('online', a, false)

    const b = () => {
      setIsOnline(false)
    }
    window.addEventListener('offline', b, false)

    return () => {
      window.removeEventListener('online', a)
      window.removeEventListener('offline', b)
    }
  }, [setIsOnline])

  return isOnline
}

export default useSSRNetworkState
