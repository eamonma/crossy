import React, { type RefObject, useRef } from 'react'
import Keyboard from 'react-simple-keyboard'

import 'react-simple-keyboard/build/css/index.css'

type Props = {
  gameboardRef: RefObject<SVGSVGElement>
  //   keyboardRef: MutableRefObject<typeof Keyboard>
}

const KeyboardWrapper: React.FC<Props> = ({
  gameboardRef,
  //   keyboardRef,
}) => {
  const keyboardRef = useRef(null)

  const onKeyPress = (button: string) => {
    if (!gameboardRef.current) return
    gameboardRef.current.focus()
    console.log(button)

    gameboardRef.current.dispatchEvent(
      new KeyboardEvent('keydown', { key: button }),
    )
  }

  return (
    <Keyboard
      keyboardRef={(r) => (keyboardRef.current = r)}
      layoutName={'default'}
      onKeyPress={onKeyPress}
      layout={{
        default: [
          'q w e r t y u i o p',
          'a s d f g h j k l',
          'z x c v b n m Delete',
        ],
      }}
      display={{
        Delete: '⌫',
      }}
      buttonTheme={[
        {
          class: '!opacity-0 !w-1',
          buttons: '0 00',
        },
        {
          class: '!bg-[var(--gray-1)]',
          buttons: 'q w e r t y u i o p a s d f g h j k l z x c v b n m Delete',
        },
      ]}
      theme="hg-theme-default hg-layout-default !bg-[var(--gray-3)]"
    />
  )
}

export default KeyboardWrapper
