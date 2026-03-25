/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        gh: {
          canvas:           '#0d1117',
          'canvas-subtle':  '#161b22',
          'canvas-inset':   '#010409',
          overlay:          '#1c2128',
          border:           '#30363d',
          'border-muted':   '#21262d',
          text:             '#e6edf3',
          'text-secondary': '#8b949e',
          'text-muted':     '#484f58',
          accent:           '#58a6ff',
          'accent-em':      '#1f6feb',
          success:          '#3fb950',
          'success-em':     '#238636',
          danger:           '#f85149',
          'danger-em':      '#da3633',
          warning:          '#d29922',
        },
      },
    },
  },
  plugins: [],
}
