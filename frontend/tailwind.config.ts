import type { Config } from "tailwindcss";

const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: hsl("--border"),
        input: hsl("--input"),
        ring: hsl("--ring"),
        background: hsl("--background"),
        foreground: hsl("--foreground"),
        muted: { DEFAULT: hsl("--muted"), foreground: hsl("--muted-foreground") },
        card: { DEFAULT: hsl("--card"), raised: hsl("--card-raised"), foreground: hsl("--foreground") },
        primary: { DEFAULT: hsl("--primary"), foreground: hsl("--primary-foreground") },
        brand: { DEFAULT: hsl("--primary"), deep: hsl("--brand-deep") },
        secondary: { DEFAULT: hsl("--secondary"), foreground: hsl("--foreground") },
        destructive: { DEFAULT: hsl("--destructive"), foreground: hsl("--foreground") },
        up: hsl("--up"),
        down: hsl("--down"),
        // Validated chart pair per theme (see globals.css): identity for USDG/stock and YES/NO.
        s1: "rgb(var(--s1) / <alpha-value>)",
        s2: "rgb(var(--s2) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "calc(var(--radius) + 4px)", lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: { "pulse-dot": { "0%,100%": { opacity: "1" }, "50%": { opacity: ".35" } } },
      animation: { "pulse-dot": "pulse-dot 2s ease-in-out infinite" },
    },
  },
  plugins: [],
};
export default config;
