import { Theme } from '@radix-ui/themes'
import { Analytics } from '@vercel/analytics/react'
import { Inter } from 'next/font/google'

import Providers from './providers'

import './globals.css'
import './theme-config.css'

const defaultUrl =
  process.env.VERCEL_URL != null
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

export const metadata = {
  metadataBase: new URL(defaultUrl),
  title: 'Crossy',
  description: 'Solve crosswords together',
}

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>
          <Theme accentColor="gold">{children}</Theme>
          <Analytics />
        </Providers>
      </body>
    </html>
  )
}
