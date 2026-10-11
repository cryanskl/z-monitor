import { Dashboard } from "./components/Dashboard";
import { SettingsPanel } from "./components/SettingsPanel";
import { FansPanel } from "./components/FansPanel";
import { DetailsPanel } from "./components/DetailsPanel";
import { useMonitor } from "./useMonitor";

function MonitorPanel({ panel }: { panel: string | null }) {
  const monitor = useMonitor();
  if (panel === "fans") return <FansPanel {...monitor} />;
  if (panel === "details") return <DetailsPanel {...monitor} />;
  return <Dashboard {...monitor} />;
}
export default function App() {
  const panel = new URLSearchParams(location.search).get("panel");
  return panel === "settings" ? (
    <SettingsPanel />
  ) : (
    <MonitorPanel panel={panel} />
  );
}
