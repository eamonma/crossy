import { useEffect } from 'react'

import useSSRWindowSize from '../../useSSRWindowSize'

const useSwipablePreventScroll = (breakpoint: number = 640) => {
  const { width } = useSSRWindowSize()

  useEffect(() => {
    if (width < breakpoint) {
      document.body.classList.add('overflow-hidden')
    }

    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [width, breakpoint])
}

export default useSwipablePreventScroll
