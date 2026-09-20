"use client";

import { useEffect, useMemo, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "polynovea-cms-theme";

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

export default function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemePreference | null;
    const initial: ThemePreference = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    setPreference(initial);
    applyTheme(initial);

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const current = (window.localStorage.getItem(STORAGE_KEY) as ThemePreference | null) || "system";
      if (current === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const options = useMemo(() => [
    { value: "system" as const, label: "System", icon: Monitor },
    { value: "dark" as const, label: "Dark", icon: Moon },
    { value: "light" as const, label: "Light", icon: Sun },
  ], []);

  const current = options.find((option) => option.value === preference) ?? options[0];
  const CurrentIcon = current.icon;

  const cycle = () => {
    const index = options.findIndex((option) => option.value === preference);
    const next = options[(index + 1) % options.length].value;
    window.localStorage.setItem(STORAGE_KEY, next);
    setPreference(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg-secondary"
      title={`Theme: ${current.label}. Click to switch.`}
      aria-label={`Theme: ${current.label}. Click to switch.`}
    >
      <CurrentIcon size={14} strokeWidth={1.5} />
      <span className="hidden lg:inline">{current.label}</span>
    </button>
  );
}
