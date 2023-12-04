'use client'

import { Button, TextField } from '@radix-ui/themes'

const Form = () => {
  return (
    <>
      <label className="text-md" htmlFor="email">
        Email
      </label>
      <TextField.Input name="email" placeholder="you@example.com" required />
      <label className="text-md" htmlFor="password">
        Password
      </label>
      <TextField.Input
        type="password"
        name="password"
        placeholder="••••••••"
        required
      />
      <Button className="bg-green-700 rounded-md px-4 py-2 text-foreground mb-2">
        Sign In
      </Button>
      {/* <Button
          variant='outline'
          formAction={signUp}
          className='border border-foreground/20 rounded-md px-4 py-2 text-foreground mb-2'
        >
          Sign Up
        </Button> */}
    </>
  )
}

export default Form
