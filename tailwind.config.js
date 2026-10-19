const v = (n) => `rgb(var(--${n}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { bg: v("bg"), panel: v("panel"), raised: v("raised"), line: v("line"), ink: v("ink"), mute: v("mute"), violet: v("violet"), blue: v("blue"), ok: v("ok"), warn: v("warn"), bad: v("bad") },
      fontFamily: { display: ["'Bricolage Grotesque'", "system-ui", "sans-serif"], sans: ["Figtree", "system-ui", "sans-serif"] },
      borderRadius: { xl2: "18px" },
    },
  },
  plugins: [],
};
