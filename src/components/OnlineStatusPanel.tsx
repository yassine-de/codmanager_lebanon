import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Users, Wifi, WifiOff, Clock } from "lucide-react";
import { useMemo } from "react";

type PresenceStatus = "online" | "idle" | "offline";

interface UserPresence {
  user_id: string;
  name: string;
  role: string;
  status: PresenceStatus;
  lastSeen: Date;
  timeAgo: string;
}

function getStatus(lastSeen: Date, isActive: boolean): PresenceStatus {
  const diffMs = Date.now() - lastSeen.getTime();
  const diffMin = diffMs / 60_000;
  if (isActive && diffMin < 2) return "online";
  if (diffMin < 5) return "idle";
  return "offline";
}

function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusConfig = {
  online: {
    color: "bg-emerald-500",
    ring: "ring-emerald-500/20",
    text: "text-emerald-600",
    label: "Online",
    glow: "shadow-[0_0_8px_rgba(16,185,129,0.4)]",
  },
  idle: {
    color: "bg-amber-500",
    ring: "ring-amber-500/20",
    text: "text-amber-600",
    label: "Idle",
    glow: "shadow-[0_0_8px_rgba(245,158,11,0.3)]",
  },
  offline: {
    color: "bg-red-400",
    ring: "ring-red-400/20",
    text: "text-red-500",
    label: "Offline",
    glow: "",
  },
};

export default function OnlineStatusPanel() {
  // Fetch presence data
  const { data: presenceData = [] } = useQuery({
    queryKey: ["user-presence"],
    queryFn: async () => {
      const { data } = await supabase.from("user_presence" as any).select("*");
      return (data || []) as any[];
    },
    refetchInterval: 15_000,
  });

  // Fetch profiles and roles for agents + admins
  const { data: rolesData = [] } = useQuery({
    queryKey: ["presence-roles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("role", ["agent", "admin"]);
      return data || [];
    },
  });

  const userIds = useMemo(() => rolesData.map((r) => r.user_id), [rolesData]);

  const { data: profiles = [] } = useQuery({
    queryKey: ["presence-profiles", userIds],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const { data } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", userIds);
      return data || [];
    },
    enabled: userIds.length > 0,
  });

  const users: UserPresence[] = useMemo(() => {
    const profileMap: Record<string, string> = {};
    profiles.forEach((p) => {
      profileMap[p.user_id] = p.name;
    });

    const presenceMap: Record<string, any> = {};
    presenceData.forEach((p: any) => {
      presenceMap[p.user_id] = p;
    });

    return rolesData.map((r) => {
      const presence = presenceMap[r.user_id];
      const lastSeen = presence ? new Date(presence.last_seen) : new Date(0);
      const isActive = presence?.is_active ?? false;
      const status = presence ? getStatus(lastSeen, isActive) : "offline";

      return {
        user_id: r.user_id,
        name: profileMap[r.user_id] || "Unknown",
        role: r.role,
        status,
        lastSeen,
        timeAgo: formatTimeAgo(lastSeen),
      };
    }).sort((a, b) => {
      const order = { online: 0, idle: 1, offline: 2 };
      return order[a.status] - order[b.status];
    });
  }, [rolesData, profiles, presenceData]);

  const onlineCount = users.filter((u) => u.status === "online").length;
  const idleCount = users.filter((u) => u.status === "idle").length;

  return (
    <div
      className="bg-card rounded-xl border animate-slide-up overflow-hidden"
      style={{ animationDelay: "420ms" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10">
            <Users className="w-4 h-4 text-emerald-600" />
          </div>
          <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Team Status
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {onlineCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded-full">
              <Wifi className="w-2.5 h-2.5" />
              {onlineCount}
            </span>
          )}
          {idleCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded-full">
              <Clock className="w-2.5 h-2.5" />
              {idleCount}
            </span>
          )}
        </div>
      </div>

      {/* User list */}
      <div className="divide-y max-h-[300px] overflow-y-auto">
        {users.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <WifiOff className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No team members found</p>
          </div>
        ) : (
          users.map((u) => {
            const cfg = statusConfig[u.status];
            return (
              <div
                key={u.user_id}
                className="px-4 py-2.5 flex items-center gap-3 hover:bg-muted/30 transition-colors"
              >
                {/* Avatar with status dot */}
                <div className="relative">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-muted to-muted/60 flex items-center justify-center text-xs font-bold text-muted-foreground uppercase">
                    {u.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)}
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-card ${cfg.color} ${cfg.glow}`}
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold truncate">{u.name}</p>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider shrink-0">
                      {u.role}
                    </span>
                  </div>
                  <p className={`text-[10px] font-medium ${cfg.text} mt-0.5`}>
                    {u.status === "online"
                      ? "Active now"
                      : u.status === "idle"
                      ? "Away — system open"
                      : `Offline — ${u.timeAgo}`}
                  </p>
                </div>

                {/* Status indicator */}
                <div
                  className={`w-2 h-2 rounded-full ${cfg.color} ${cfg.glow} shrink-0`}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
