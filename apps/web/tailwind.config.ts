import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0B0C0E",
          900: "#12141A",
          800: "#1A1D26",
          700: "#2A2F3A",
          500: "#6B7280",
          300: "#C5CAD3",
          100: "#EDEEF2",
        },
        gold: {
          500: "#C4A35A",
          400: "#D4B76A",
          300: "#E2C98A",
        },
        mist: "#F6F4F0",
        sea: "#1F4E5F",
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        panel: "0 24px 80px rgba(0,0,0,0.35)",
        soft: "0 8px 30px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
