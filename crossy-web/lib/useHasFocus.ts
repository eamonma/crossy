import { useEffect, useState } from 'react'

const useHasFocus = () => {
  // get the initial state
  const [focus, setFocus] = useState(false)

  useEffect(() => {
    setFocus(document.hasFocus())
    // helper functions to update the status
    const onFocus = () => setFocus(true)
    const onBlur = () => setFocus(false)

    // assign the listener
    // update the status on the event
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)

    // remove the listener
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // return the status
  return focus
}

export default useHasFocus
