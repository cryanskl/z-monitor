import { useEffect, useState } from "react";
import { features } from "./features";

export interface Preferences {
  enabled: string[];
  hotkeys: Record<string, number>;
  shortcuts: "off" | "double";
  customApps: { path: string; label: string }[];
}
const key = "z-monitor.preferences.v1";
function read(): Preferences {
  const saved = localStorage.getItem(key);
  return saved
    ? { hotkeys: {}, shortcuts: "off", ...JSON.parse(saved) }
    : {
        enabled: features.map((feature) => feature.id),
        customApps: [],
        hotkeys: {},
        shortcuts: "off",
      };
}
export function usePreferences() {
  const [preferences, setPreferences] = useState(read);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setPreferences(read());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const save = (next: Preferences) => {
    localStorage.setItem(key, JSON.stringify(next));
    setPreferences(next);
  };
  return [preferences, save] as const;
}
