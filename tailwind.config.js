/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          950: '#070a10',
          900: '#0f1622',
          800: '#192332',
        },
      },
      boxShadow: {
        led: '0 0 12px rgba(57,255,20,0.75)',
        danger: '0 0 20px rgba(239,68,68,0.6)',
      },
    },
  },
  plugins: [],
}

