import type { Config } from "tailwindcss";

/* The hero itself is styled with inline styles and the tokens in app/theme.ts,
   so Tailwind is here only for whatever you build around it. */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
};

export default config;
