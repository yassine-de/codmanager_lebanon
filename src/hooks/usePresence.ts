import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

export function usePresenceHeartbeat() {
  const { user } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;

    const sendHeartbeat = async () => {
      await supabase.rpc("touch_user_presence" as any);
    };

    // Send immediately
    sendHeartbeat();

    // Then every 30s
    intervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Mark inactive on page hide
    const handleVisibility = () => {
      if (document.hidden) {
        supabase.rpc("set_user_presence_inactive" as any).then();
      } else {
        sendHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      // Mark offline on unmount
      supabase.rpc("set_user_presence_inactive" as any).then();
    };
  }, [user?.id]);
}
