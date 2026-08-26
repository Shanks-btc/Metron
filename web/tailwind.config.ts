import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Named "canvas", not "base" - Tailwind's default theme already has a
        // fontSize key called "base" (1rem), and a custom color sharing that
        // name silently makes `text-base`/`sm:text-base` etc. also apply
        // `color: #05060a`, invisibly matching this exact background color.
        canvas: "#05060a",
        surface: {
          from: "#141420",
          to: "#0e0e18",
        },
        ink: {
          heading: "#f5f4fb",
          body: "#a3a5b8",
          label: "#9491a8",
        },
        accent: {
          light: "#a78bfa",
          DEFAULT: "#7c5cff",
          dark: "#5b3fd6",
        },
        success: "#4ade80",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
      },
      borderColor: {
        subtle: "rgba(139,124,246,0.15)",
        strong: "rgba(139,124,246,0.35)",
      },
      backgroundImage: {
        "accent-gradient": "linear-gradient(135deg, #a78bfa 0%, #7c5cff 55%, #5b3fd6 100%)",
        "surface-gradient": "linear-gradient(160deg, #141420 0%, #0e0e18 100%)",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(139,124,246,0.15), 0 8px 40px -12px rgba(124,92,255,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
