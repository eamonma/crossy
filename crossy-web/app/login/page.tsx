import { ArrowLeftIcon } from '@radix-ui/react-icons'
import { Link as RadixLink, Text } from '@radix-ui/themes'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

import Form from './loginForm'
import Main from './main'

export default function Login({
  searchParams,
}: {
  searchParams: { message: string }
}) {
  const signIn = async (formData: FormData) => {
    'use server'

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      return redirect('/login?message=Could not authenticate user')
    }

    return redirect('/')
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <RadixLink className="absolute flex items-center top-4 left-4" asChild>
        <Link href="/">
          <ArrowLeftIcon className="mr-1" />
          Back
        </Link>
      </RadixLink>

      <div className="flex flex-col w-full max-w-sm p-4 border border-gray-300 rounded-lg shadow-sm bg-gray-25">
        <div className="flex justify-between ">
          <Text asChild>
            <span className="font-serif text-lg font-bold">Crossy</span>
          </Text>
          <Text asChild>
            <span className="font-serif text-lg">Sign in</span>
          </Text>
        </div>
        <hr className="my-3" />
        <Main />

        {searchParams?.message && (
          <>
            <hr className="my-4" />
            <p className="mb-4 text-center bg-foreground/10 text-foreground">
              {searchParams.message}
            </p>
          </>
        )}

        {process.env.NODE_ENV === 'development' && (
          <details className="mt-2">
            <summary className="text-xs opacity-50">Login with email</summary>
            <form action={signIn}>
              <Form />
            </form>
          </details>
        )}
      </div>
    </div>
  )
}
