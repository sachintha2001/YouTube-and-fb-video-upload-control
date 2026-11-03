/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#0b0f19',
          panel: '#111827',
          card: '#1a2234',
          border: '#263249',
        },
      },
    },
  },
  plugins: [],
};
