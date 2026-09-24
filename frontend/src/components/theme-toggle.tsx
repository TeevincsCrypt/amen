"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type Theme = "light" | "dark";
export const THEME_KEY = "amen:theme";

/**
 * Runs in <head> before the page paints, so the page never flashes the wrong theme: the saved
 * choice if there is one, otherwise the device setting. Must stay dependency-free.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";var d=document.documentElement;d.dataset.theme=t;d.classList.toggle("dark",t==="dark")}catch(e){}})()`;

function applyTheme(t: Theme) {
  const d = document.documentElement;
  d.dataset.theme = t;
  d.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // private mode or blocked storage: the choice lasts for this page view only
  }
}

/** Light / dark switch. Renders an empty slot of the same size until mounted, to avoid a hydration mismatch. */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"), []);
  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      aria-label={theme ? `Switch to ${next} mode` : "Switch theme"}
      title={theme ? `Switch to ${next} mode` : undefined}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card-raised/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {theme === "light" ? <Moon className="h-4 w-4" /> : theme === "dark" ? <Sun className="h-4 w-4" /> : null}
    </button>
  );
}
