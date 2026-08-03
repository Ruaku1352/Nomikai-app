/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0f172a',
        surface: '#1e293b',
        accent: '#f97316',
      },
    },
  },
  plugins: [],
};
