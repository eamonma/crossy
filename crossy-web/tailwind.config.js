/** @type {import('tailwindcss').Config} */
import radixThemePlugin from 'radix-ui-themes-with-tailwind'

module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['harfang-pro', 'serif'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        btn: {
          background: 'hsl(var(--btn-background))',
          'background-hover': 'hsl(var(--btn-background-hover))',
        },
      },
    },
  },
  plugins: [require('tailwind-scrollbar')({ nocompatible: true })],
  plugins: [
    radixThemePlugin({
      useTailwindColorNames: true, // optional
      useTailwindRadiusNames: true, // optional
      mapMissingTailwindColors: true, // optional
    }),
  ],
  // presets: [radixThemePreset],
}
