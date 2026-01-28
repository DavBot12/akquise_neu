import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        'meta': '0.05em',
      },
      gridTemplateColumns: {
        '24': 'repeat(24, minmax(0, 1fr))',
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        // SIRA Group CI (Official Brand Colors)
        navy: {
          DEFAULT: '#000324', // SIRA Blue (Hauptfarbe)
          hover: '#001a4d',  // Hover-Zustand für Buttons
          50: '#ffffff',     // Weiß
          100: '#f5f5f5',    // Hellgrau (Hintergründe)
          200: '#e0e0e0',    // Grau (Borders)
          300: '#6c757d',    // Grau (Sekundärtext)
          400: '#dee2e6',    // Hellgrau (Trennlinien)
          500: '#000324',    // SIRA Blue
        },
        sira: {
          navy: '#000324',           // SIRA Blue (Hauptfarbe)
          'navy-hover': '#001a4d',   // Hover-Zustand
          background: '#ffffff',     // Weiß (Hauptinhalt)
          'background-alt': '#f5f5f5', // Hellgrau (Hintergründe, Image-Container)
          'light-gray': '#e0e0e0',   // Grau (Borders, Trennlinien)
          'input-gray': '#e6e6e6',   // Input-Backgrounds
          'map-gray': '#e5e3df',     // Map-Background
          'medium-gray': '#6c757d',  // Grau (Sekundärtext, Kleingedrucktes)
          'divider-gray': '#dee2e6', // Hellgrau (Trennlinien in Listen)
          'text-gray': '#6c757d',    // Sekundärtext
          success: '#065F46',        // Grün (Erfolg)
          danger: '#991B1B',         // Rot (Fehler)
          warning: '#856404',        // Dunkler Gelbton (Warning-Text)
          'warning-bg': '#fff3cd',   // Gelber Hintergrund (Warnungen)
          'warning-border': '#ffc107', // Gelber Border (Warnungen)
          info: '#003b8a',           // Blau (Info) - Legacy
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar-background)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
} satisfies Config;
