import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#151310",
        paper: "#fbfaf7",
        moss: "#5f6f52",
        clay: "#b5634a",
        wheat: "#e7d6b8",
        fog: "#eef0ea"
      },
      boxShadow: {
        soft: "0 18px 60px rgba(21, 19, 16, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
