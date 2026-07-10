import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Stock tailwind-merge only knows the t-shirt font sizes, so it classed this theme's
// numeric scale (text-0..text-9, styles.css) as text *colors* and dropped the size
// whenever a real color shared the merge: every cn-built recipe (button, badge,
// CapsLabel) silently lost its font size and inherited the 16px body default. Declaring
// the scale puts sizes and colors back in separate groups so both survive a merge.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "0",
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "display-sm",
            "display-md",
            "display-lg",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
