type AgentDebugLevel = "info" | "warn" | "error";

type AgentDebugEntry = {
  timestamp: string;
  level: AgentDebugLevel;
  event: string;
  details?: Record<string, unknown>;
  path?: string;
  online?: boolean;
};

const AGENT_DEBUG_LOG_KEY = "codmanager:agentDebugLog";
const MAX_AGENT_DEBUG_ENTRIES = 300;

function safeDetails(details?: Record<string, unknown>) {
  if (!details) return undefined;

  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (/token|password|secret|key/i.test(key)) return [key, "[redacted]"];
      return [key, value];
    }),
  );
}

function readEntries(): AgentDebugEntry[] {
  try {
    const raw = localStorage.getItem(AGENT_DEBUG_LOG_KEY);
    return raw ? (JSON.parse(raw) as AgentDebugEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendAgentDebugLog(
  event: string,
  details?: Record<string, unknown>,
  level: AgentDebugLevel = "info",
) {
  const entry: AgentDebugEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    details: safeDetails(details),
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
  };

  try {
    const entries = [...readEntries(), entry].slice(-MAX_AGENT_DEBUG_ENTRIES);
    localStorage.setItem(AGENT_DEBUG_LOG_KEY, JSON.stringify(entries));
  } catch {
    // Keep console logging even if storage is unavailable.
  }

  const log = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  log("[AgentDebug]", entry);
}

export function downloadAgentDebugLog() {
  const entries = readEntries();
  const payload = {
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
    online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
    entries,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cod-agent-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
