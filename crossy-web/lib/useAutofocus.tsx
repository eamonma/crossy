import { type RefObject, useEffect } from 'react'

const useAutofocus = <T extends HTMLElement | SVGElement>(
  ref: RefObject<T>,
) => {
  useEffect(() => {
    if (ref.current) {
      ref.current.focus()
    }
  }, [ref])
}

export default useAutofocus
