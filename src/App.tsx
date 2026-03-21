import { useState } from "react";
import CapabilityTest from "./components/CapabilityTest";
import PresenceDetector from "./components/PresenceDetector";

type Tab = "capability" | "presence";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("capability");

  return (
    <div style={{ padding: "16px", fontFamily: "sans-serif" }}>
      <h1>ggwave Proximity Demo</h1>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button onClick={() => setActiveTab("capability")}>
          Capability Test
        </button>
        <button onClick={() => setActiveTab("presence")}>
          Presence Detection
        </button>
      </div>

      {activeTab === "capability" ? <CapabilityTest /> : <PresenceDetector />}
    </div>
  );
}