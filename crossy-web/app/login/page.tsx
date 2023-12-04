import { ArrowLeftIcon, DiscordLogoIcon } from '@radix-ui/react-icons'
import { Button, Text } from '@radix-ui/themes'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { createClient } from '@/utils/supabase/server'

import Form from './loginForm'

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

  const signUp = async (formData: FormData) => {
    'use server'

    const origin = headers().get('origin')
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
      },
    })

    if (error) {
      return redirect('/login?message=Could not authenticate user')
    }

    return redirect('/login?message=Check email to continue sign in process')
  }

  const signInWithDiscord = async () => {
    'use server'
    const cookieStore = cookies()
    const supabase = createClient(cookieStore)

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${headers().get('origin')}/auth/callback`,
      },
    })

    if (error) {
      return redirect('/login?message=Could not authenticate user')
    }

    return redirect(data.url)
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-transparent">
      <Link
        href="/"
        className="absolute left-8 top-8 py-2 px-4 rounded-md no-underline text-black bg-btn-background hover:bg-btn-background-hover flex items-center group text-sm"
      >
        <ArrowLeftIcon className="mr-2" />
        {/* <svg
          xmlns='http://www.w3.org/2000/svg'
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
          className='mr-2 h-4 w-4 transition-transform group-hover:-translate-x-1'
        >
          <polyline points='15 18 9 12 15 6' />
        </svg>{' '} */}
        Back
      </Link>

      <div className="flex flex-col w-full max-w-sm border border-grayA-1 shadow-2 p-4 rounded-5">
        <div className="flex justify-between ">
          <Text asChild>
            <span className="text-lg font-serif">Crossy</span>
          </Text>
          <Text asChild>
            <span className="text-lg font-serif">Sign in</span>
          </Text>
        </div>
        <hr className="my-4 border-grayA-5" />
        <form action={signInWithDiscord} className="flex flex-col">
          <Button
            type="submit"
            color="cyan"
            className="text-black flex items-center gap-2 cursor-pointer"
          >
            <DiscordLogoIcon />
            Sign in with Discord
          </Button>
        </form>

        {searchParams?.message && (
          <>
            <hr className="my-4 border-grayA-5" />
            <p className="mb-4 bg-foreground/10 text-foreground text-center">
              {searchParams.message}
            </p>
          </>
        )}

        <details className="mt-2">
          <summary>Login with email</summary>
          <form action={signIn}>
            <Form />
          </form>
        </details>
      </div>
    </div>
  )
}

// 'use client';
// import { Auth } from '@supabase/auth-ui-react';
// import { ThemeSupa } from '@supabase/auth-ui-shared';
// import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
// // import { Database } from './database.types';

// export default function AuthForm() {
//   const supabase = createClientComponentClient();

//   return (
//     <>
//       <Auth
//         supabaseClient={supabase}
//         view='sign_up'
//         appearance={{ theme: ThemeSupa }}
//         theme='dark'
//         showLinks={false}
//         providers={['discord']}
//         redirectTo='http://localhost:3000/auth/callback'
//       />{' '}
//       <Auth
//         supabaseClient={supabase}
//         view='sign_in'
//         appearance={{ theme: ThemeSupa }}
//         theme='dark'
//         showLinks={false}
//         providers={['discord']}
//         redirectTo='http://localhost:3000/auth/callback'
//       />
//     </>
//   );
// }
