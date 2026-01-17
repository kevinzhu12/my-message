import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

/**
 * Determines if it's currently daytime based on the hour
 * Daytime is considered 6 AM to 6 PM
 */
function isDaytime(): boolean {
  const hour = new Date().getHours();
  return hour >= 6 && hour < 18;
}

/**
 * Hook that automatically switches between light and dark mode based on time of day
 * Updates every minute to check if the theme should change
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    isDaytime() ? "light" : "dark"
  );

  useEffect(() => {
    // Update theme based on current time
    const updateTheme = () => {
      const newTheme = isDaytime() ? "light" : "dark";
      setTheme(newTheme);
    };

    // Check and update theme every minute
    const interval = setInterval(updateTheme, 60000);

    // Initial update
    updateTheme();

    return () => clearInterval(interval);
  }, []);

  // Apply theme to document element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  return theme;
}
