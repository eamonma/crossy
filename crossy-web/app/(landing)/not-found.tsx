import React from 'react'
import { Text } from '@radix-ui/themes'
import Link from 'next/link'

import CrossyLogo from '@/components/crossyLogo'

import MainThemeSwitcher from './mainThemeSwitcher'

const Page = () => {
  return (
    <div>
      <main className="flex flex-col min-h-screen bg-gray-50">
        <div className="p-4 pb-0">
          <header className="flex items-center justify-between h-12 px-5 border border-gray-300 rounded-md bg-gray-25">
            <Link href="/">
              <h1 className="flex items-center gap-1 font-serif text-lg font-bold">
                <div className="w-6 h-6 text-white rounded-full bg-gold-800 p-0.5">
                  <CrossyLogo />
                </div>
                Crossy
              </h1>
            </Link>
            <div className="flex items-center gap-4 font-medium">
              <MainThemeSwitcher isLoggedIn={false} />
            </div>
          </header>
        </div>
        <div className="flex items-stretch flex-1 h-full p-4">
          <div className="relative flex flex-col w-full gap-2 p-5 overflow-hidden border border-gray-300 rounded-md shadow-sm bg-gold-25 group">
            <Text>Page not found</Text>
          </div>
        </div>
      </main>
    </div>
  )
}

export default Page
