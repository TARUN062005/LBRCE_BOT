/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#142033',
        muted: '#5d6b7c',
        line: '#e4eaf1',
        canvas: '#f4f7fb',
        brand: {
          DEFAULT: '#0c3d6e',
          dark: '#082844',
          light: '#e7f0f8',
        },
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 36, 58, 0.06), 0 8px 24px rgba(16, 36, 58, 0.04)',
      },
    },
  },
  plugins: [],
};
