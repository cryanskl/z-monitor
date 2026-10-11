import { useEffect, useState } from "react";
import { snapshot } from "./api";
import type { Snapshot } from "./types";

export function useMonitor() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let lastTimestamp = 0;
    const refresh = async () => {
      try {
        const next = await snapshot();
        if (stopped) return;
        setData(next);
        setError(null);
        if (next.timestamp !== lastTimestamp) {
          setHistory((previous) => [...previous.slice(-59), next]);
          lastTimestamp = next.timestamp;
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      }
      if (!stopped) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return { data, history, error };
}
