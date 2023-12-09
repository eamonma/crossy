'use client'

import { Button, TextField } from '@radix-ui/themes'

const Form = () => {
  return (
    <div className="flex flex-col gap-1 mt-4">
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
      <div className="flex flex-col w-full mt-4">
        <Button>Sign in</Button>
      </div>
    </div>
  )
}

export default Form
