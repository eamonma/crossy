'use client'

import { ThemeProvider } from 'next-themes'

type Props = {
  children: React.ReactNode
}

const Providers: React.FC<Props> = ({ children }) => {
  return <ThemeProvider attribute="class">{children}</ThemeProvider>
}

export default Providers
