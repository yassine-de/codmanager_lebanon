import { useMemo } from "react";
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  PhoneOff,
  RotateCcw,
  Zap,
  Award,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentOrderData {
  agent_id: string;
  confirmation_status: string;
  delivery_status: string | null;
  created_at: string;
  attempt_count: number;
  postpone_date: string | null;
}

interface OrderHistoryEntry {
  order_id: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

interface CallData {
  agent_id: string;
  duration: number | null;
}

interface Props {
  orders: AgentOrderData[];
  orderHistory: OrderHistoryEntry[];
  calls: CallData[];
  profileNameMap: Record<string, string>;
  agentIds: string[];
}

interface AgentInsight {
  agentId: string;
  name: string;
  totalHandled: number;
  confirmed: number;
  noAnswer: number;
  confirmationRate: number;
  noAnswerRate: number;
  avgCallDurationSec: number | null;
  avgTimePerOrderMs: number | null;
  avgRetries: number;
  confirmedAfterRetryRate: number;
  issues: Issue[];
  recommendations: string[];
  level: "critical" | "warning" | "good";
}

interface Issue {
  type: string;
  message: string;
  severity: "critical" | "warning" | "info";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatMs(ms: number): string {
  return formatDuration(ms / 1000);
}

export function SmartRecommendations({ orders, orderHistory, calls, profileNameMap, agentIds }: Props) {
  const insights = useMemo(() => {
    // Build agent claim timestamps from order_history
    const agentClaimMap: Record<string, string> = {};
    const firstChangeAfterClaim: Record<string, string> = {};

    orderHistory.forEach((h) => {
      if (h.field_changed === "agent_id" && !h.old_value && h.new_value && !agentClaimMap[h.order_id]) {
        agentClaimMap[h.order_id] = h.created_at;
      }
    });

    orderHistory.forEach((h) => {
      if (h.field_changed === "confirmation_status" && agentClaimMap[h.order_id] && !firstChangeAfterClaim[h.order_id]) {
        const claimTime = new Date(agentClaimMap[h.order_id]).getTime();
        const changeTime = new Date(h.created_at).getTime();
        if (changeTime >= claimTime) {
          firstChangeAfterClaim[h.order_id] = h.created_at;
        }
      }
    });

    // Build order -> agent map from orders
    const orderAgentMap: Record<string, string> = {};
    orders.forEach((o) => {
      if (o.agent_id) orderAgentMap[o.agent_id] = o.agent_id; // just for existence check
    });

    // Calls per agent
    const callsByAgent: Record<string, number[]> = {};
    calls.forEach((c) => {
      if (c.duration && c.duration > 0) {
        if (!callsByAgent[c.agent_id]) callsByAgent[c.agent_id] = [];
        callsByAgent[c.agent_id].push(c.duration);
      }
    });

    // Group orders by agent
    const agentOrders: Record<string, AgentOrderData[]> = {};
    orders.forEach((o) => {
      if (!o.agent_id) return;
      if (!agentOrders[o.agent_id]) agentOrders[o.agent_id] = [];
      agentOrders[o.agent_id].push(o);
    });

    // Compute per-agent insights
    const allInsights: AgentInsight[] = [];

    // First pass: compute all handling times to get team average
    const allHandlingTimes: number[] = [];

    for (const agentId of agentIds) {
      const aOrders = agentOrders[agentId] || [];
      if (aOrders.length === 0) continue;

      // Handling times for this agent
      aOrders.forEach((o) => {
        // Use order_id from order - we need to match with history
        // Since we don't have order_id on the orders prop, use created_at diff as proxy
      });
    }

    // Compute handling times from order_history
    const handlingTimeByAgent: Record<string, number[]> = {};
    for (const [orderId, changeTime] of Object.entries(firstChangeAfterClaim)) {
      if (!agentClaimMap[orderId]) continue;
      const diff = new Date(changeTime).getTime() - new Date(agentClaimMap[orderId]).getTime();
      if (diff > 0 && diff < 86400000) {
        // Find which agent this order belongs to via history
        const claimEntry = orderHistory.find(
          (h) => h.field_changed === "agent_id" && h.order_id === orderId && !h.old_value && h.new_value
        );
        if (claimEntry?.new_value) {
          if (!handlingTimeByAgent[claimEntry.new_value]) handlingTimeByAgent[claimEntry.new_value] = [];
          handlingTimeByAgent[claimEntry.new_value].push(diff);
          allHandlingTimes.push(diff);
        }
      }
    }

    const teamAvgHandlingMs =
      allHandlingTimes.length > 0 ? allHandlingTimes.reduce((s, v) => s + v, 0) / allHandlingTimes.length : 0;

    for (const agentId of agentIds) {
      const aOrders = agentOrders[agentId] || [];
      if (aOrders.length === 0) continue;

      const totalHandled = aOrders.filter(
        (o) =>
          o.confirmation_status !== "new" ||
          o.postpone_date !== null
      ).length;

      if (totalHandled === 0) continue;

      const confirmed = aOrders.filter((o) => o.confirmation_status === "confirmed").length;
      const noAnswer = aOrders.filter((o) => o.confirmation_status === "no_answer").length;
      const confirmationRate = totalHandled > 0 ? Math.round((confirmed / totalHandled) * 100) : 0;
      const noAnswerRate = totalHandled > 0 ? Math.round((noAnswer / totalHandled) * 100) : 0;

      // Call duration
      const agentCalls = callsByAgent[agentId] || [];
      const avgCallDurationSec =
        agentCalls.length > 0 ? agentCalls.reduce((s, v) => s + v, 0) / agentCalls.length : null;

      // Handling time
      const handlingTimes = handlingTimeByAgent[agentId] || [];
      const avgTimePerOrderMs =
        handlingTimes.length > 0 ? handlingTimes.reduce((s, v) => s + v, 0) / handlingTimes.length : null;

      // Retries
      const totalRetries = aOrders.reduce((s, o) => s + (o.attempt_count || 0), 0);
      const avgRetries = aOrders.length > 0 ? totalRetries / aOrders.length : 0;

      // Confirmed after retry
      const confirmedAfterRetry = aOrders.filter(
        (o) => o.confirmation_status === "confirmed" && (o.attempt_count || 0) > 1
      ).length;
      const confirmedAfterRetryRate = confirmed > 0 ? Math.round((confirmedAfterRetry / confirmed) * 100) : 0;

      // Issue detection
      const issues: Issue[] = [];
      const recommendations: string[] = [];

      // 1. Low confirmation rate
      if (confirmationRate < 50) {
        issues.push({ type: "low_confirmation", message: "Low confirmation rate — needs training on closing", severity: "critical" });
        recommendations.push("Training on closing script");
      }

      // 2. High no answer rate
      if (noAnswerRate > 40) {
        issues.push({ type: "high_no_answer", message: "High no answer rate — improve call timing", severity: "critical" });
        recommendations.push("Adjust calling hours");
      }

      // 3. Long call duration
      if (avgCallDurationSec && avgCallDurationSec > 180) {
        issues.push({ type: "long_calls", message: "Calls are too long — inefficient communication", severity: "warning" });
        recommendations.push("Optimize script");
      }

      // 4. Too many retries
      if (avgRetries > 2) {
        issues.push({ type: "high_retries", message: "Too many retries — low first-call efficiency", severity: "warning" });
        recommendations.push("Focus on first-call success");
      }

      // 5. Slow handling
      if (avgTimePerOrderMs && teamAvgHandlingMs > 0 && avgTimePerOrderMs > teamAvgHandlingMs * 1.3) {
        issues.push({ type: "slow_handling", message: "Agent is slow — improve handling speed", severity: "warning" });
        recommendations.push("Improve workflow speed");
      }

      // 6. High performer
      if (confirmationRate > 70 && noAnswerRate < 25) {
        issues.push({ type: "high_performer", message: "High performer — use as benchmark", severity: "info" });
      }

      // Determine level
      let level: "critical" | "warning" | "good" = "good";
      if (issues.some((i) => i.severity === "critical")) level = "critical";
      else if (issues.some((i) => i.severity === "warning")) level = "warning";

      allInsights.push({
        agentId,
        name: profileNameMap[agentId] || agentId.slice(0, 8),
        totalHandled,
        confirmed,
        noAnswer,
        confirmationRate,
        noAnswerRate,
        avgCallDurationSec,
        avgTimePerOrderMs,
        avgRetries: Math.round(avgRetries * 10) / 10,
        confirmedAfterRetryRate,
        issues,
        recommendations,
        level,
      });
    }

    // Sort: critical first, then warning, then good. Within each: lowest confirmation rate first
    return allInsights.sort((a, b) => {
      const levelOrder = { critical: 0, warning: 1, good: 2 };
      if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
      return a.confirmationRate - b.confirmationRate;
    });
  }, [orders, orderHistory, calls, profileNameMap, agentIds]);

  if (insights.length === 0) {
    return null;
  }

  const levelStyles = {
    critical: "border-destructive/30 bg-destructive/5",
    warning: "border-warning/30 bg-warning/5",
    good: "border-success/30 bg-success/5",
  };

  const levelIcon = {
    critical: <AlertTriangle className="h-4 w-4 text-destructive" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    good: <Award className="h-4 w-4 text-success" />,
  };

  const severityBadge = {
    critical: "bg-destructive/10 text-destructive border-destructive/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    info: "bg-success/10 text-success border-success/20",
  };

  return (
    <div className="space-y-4 animate-slide-up" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Smart Recommendations
        </h2>
        <span className="text-xs text-muted-foreground">
          ({insights.length} agent{insights.length !== 1 ? "s" : ""})
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {insights.map((agent) => (
          <div
            key={agent.agentId}
            className={cn(
              "rounded-xl border p-5 space-y-4 transition-all hover:shadow-md",
              levelStyles[agent.level]
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {levelIcon[agent.level]}
                <h3 className="font-semibold text-sm">{agent.name}</h3>
              </div>
              <span className="text-xs text-muted-foreground">{agent.totalHandled} orders handled</span>
            </div>

            {/* KPIs Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <TrendingUp className="h-3 w-3 text-muted-foreground" />
                </div>
                <p
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    agent.confirmationRate >= 70
                      ? "text-success"
                      : agent.confirmationRate >= 50
                      ? "text-warning"
                      : "text-destructive"
                  )}
                >
                  {agent.confirmationRate}%
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">Confirmation</p>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <PhoneOff className="h-3 w-3 text-muted-foreground" />
                </div>
                <p
                  className={cn(
                    "text-lg font-bold tabular-nums",
                    agent.noAnswerRate <= 25
                      ? "text-success"
                      : agent.noAnswerRate <= 40
                      ? "text-warning"
                      : "text-destructive"
                  )}
                >
                  {agent.noAnswerRate}%
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight">No Answer</p>
              </div>

              <div className="text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <RotateCcw className="h-3 w-3 text-muted-foreground" />
                </div>
                <p className="text-lg font-bold tabular-nums">{agent.avgRetries}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">Avg Retries</p>
              </div>

              {agent.avgCallDurationSec !== null && (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      agent.avgCallDurationSec <= 180 ? "text-success" : "text-warning"
                    )}
                  >
                    {formatDuration(agent.avgCallDurationSec)}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Avg Call</p>
                </div>
              )}

              {agent.avgTimePerOrderMs !== null && (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <Zap className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-bold tabular-nums">{formatMs(agent.avgTimePerOrderMs)}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Handling Time</p>
                </div>
              )}

              {agent.confirmedAfterRetryRate > 0 && (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TrendingDown className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-bold tabular-nums">{agent.confirmedAfterRetryRate}%</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">Retry Success</p>
                </div>
              )}
            </div>

            {/* Issues */}
            {agent.issues.length > 0 && (
              <div className="space-y-1.5">
                {agent.issues.map((issue, i) => (
                  <div
                    key={i}
                    className={cn("text-xs px-2.5 py-1.5 rounded-lg border", severityBadge[issue.severity])}
                  >
                    {issue.message}
                  </div>
                ))}
              </div>
            )}

            {/* Recommendations */}
            {agent.recommendations.length > 0 && (
              <div className="border-t border-border/50 pt-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-semibold">
                  Recommendations
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {agent.recommendations.map((rec, i) => (
                    <span
                      key={i}
                      className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary font-medium"
                    >
                      {rec}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
