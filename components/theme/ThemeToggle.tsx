"use client";

import { useEffect, useState } from "react";

import { Tip } from "@/components/ui/Tip";
import {
  applyTheme,
  readTheme,
  toggleTheme,
  type ThemeMode,
} from "@/components/theme/theme";

/** Standalone toggle for signed-out surfaces (landing, auth). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const next = readTheme();
    applyTheme(next);
    setTheme(next);
    setReady(true);
  }, []);

  const label =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Tip label={label}>
      <button
        type="button"
        className={`theme-toggle ${className}`.trim()}
        onClick={() => setTheme((prev) => toggleTheme(prev))}
        aria-label={label}
        title={label}
        suppressHydrationWarning
      >
        <span aria-hidden className="theme-toggle-icon">
          {ready && theme === "dark" ? "☀" : "☾"}
        </span>
        <span className="theme-toggle-text">
          {ready ? (theme === "dark" ? "Light" : "Dark") : "Theme"}
        </span>
      </button>
    </Tip>
  );
}
