import { useEffect, useState } from "react";
import { actionStatus, desktop, type ActionStatus } from "./api";
export function useActions() {
  const [status, setStatus] = useState<ActionStatus>({});
  const [statusError, setStatusError] = useState("");
  const refresh = async () => {
    if (!desktop) return;
    try {
      setStatus(await actionStatus());
      setStatusError("");
    } catch (error) {
      setStatusError(String(error));
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, []);
  return { status, statusError, refresh };
}
