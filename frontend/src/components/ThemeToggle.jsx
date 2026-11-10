"use client";

import React from "react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "imposter-theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState("night");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    if (savedTheme === "day" || savedTheme === "night") {
      setTheme(savedTheme);
      document.documentElement.dataset.theme = savedTheme;
    }
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "night" ? "day" : "night";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "night" ? "နေ့ဘက်ပုံစံသို့ ပြောင်းမည်" : "ညဘက်ပုံစံသို့ ပြောင်းမည်"}
      aria-pressed={theme === "day"}
    >
      <span aria-hidden="true">{theme === "night" ? "☀" : "☾"}</span>
      {theme === "night" ? "နေ့ဘက်" : "ညဘက်"}
    </button>
  );
}
