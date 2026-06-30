/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Semantic color tokens — change these to re-theme the entire app
        primary: {
          50: '#eff6ff',   // bg-primary-50  (selected states, highlights)
          100: '#dbeafe',  // bg-primary-100 (badge backgrounds)
          200: '#bfdbfe',  // border-primary-200 (info alert border)
          300: '#93c5fd',  // (unused — reserved)
          400: '#60a5fa',  // (unused — reserved)
          500: '#3b82f6',  // focus:ring-primary-500 (focus rings, action links)
          600: '#2563eb',  // bg-primary-600 (buttons, interactive elements)
          700: '#1d4ed8',  // hover:bg-primary-700 (hover states)
          800: '#1e40af',  // text-primary-800 (badge text on light bg)
          900: '#1e3a8a',  // (unused — reserved)
        },
        danger: {
          50: '#fef2f2',   // bg-danger-50 (error backgrounds)
          100: '#fee2e2',  // bg-danger-100 (badge backgrounds)
          200: '#fecaca',  // border-danger-200 (error alert border)
          300: '#fca5a5',  // border-danger-300 (error input border)
          400: '#f87171',  // text-danger-400 (status bar error text)
          500: '#ef4444',  // focus:ring-danger-500 (error focus ring, status dots)
          600: '#dc2626',  // bg-danger-600 (delete buttons, error text)
          700: '#b91c1c',  // hover:bg-danger-700 (hover states)
          800: '#991b1b',  // text-danger-800 (badge text)
        },
        success: {
          50: '#f0fdf4',   // bg-success-50 (success backgrounds)
          100: '#dcfce7',  // bg-success-100 (badge backgrounds)
          200: '#bbf7d0',  // border-success-200 (success alert border)
          400: '#4ade80',  // bg-success-400 (status bar dots - light green)
          500: '#22c55e',  // dot indicators
          600: '#16a34a',  // bg-success-600 (confirm buttons, status text)
          700: '#15803d',  // hover:bg-success-700 (hover states)
          800: '#166534',  // text-success-800 (badge text)
        },
        warning: {
          50: '#fefce8',   // bg-warning-50 (warning backgrounds)
          100: '#fef9c3',  // bg-warning-100 (badge backgrounds)
          200: '#fef08a',  // border-warning-200 (warning alert border)
          400: '#facc15',  // status bar indicator
          500: '#eab308',  // dot indicators
          600: '#ca8a04',  // text-warning-600 (certificate expiry)
          800: '#854d0e',  // text-warning-800 (warning text)
        },
      },
    },
  },
  plugins: [],
};
