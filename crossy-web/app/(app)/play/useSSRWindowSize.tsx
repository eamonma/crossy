import { useEffect, useState } from 'react'
import { useWindowSize } from 'react-use'

const useSSRWindowSize = () => {
  const [size, setSize] = useState({ height: 1080, width: 1920 })
  const usedSize = useWindowSize()

  useEffect(() => {
    setSize(usedSize)
  }, [usedSize, setSize])

  return size
}

export default useSSRWindowSize
