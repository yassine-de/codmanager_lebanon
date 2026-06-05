import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { appendAgentDebugLog } from "@/lib/agent-debug-log";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AppRole;
  permissions: string[];
  phone: string;
  active: boolean;
}

interface AuthContextType {
  user: User | null;
  authUser: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authUserRef = useRef<AuthUser | null>(null);
  const loadingUserDetailsForRef = useRef<string | null>(null);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  const fetchUserDetails = async (supabaseUser: User): Promise<AuthUser> => {
    const fallbackName =
      typeof supabaseUser.user_metadata?.name === "string" && supabaseUser.user_metadata.name.trim().length > 0
        ? supabaseUser.user_metadata.name
        : supabaseUser.email?.split("@")[0] || "User";

    try {
      const [{ data: profile }, { data: roleData }, { data: permsData }] = await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", supabaseUser.id).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", supabaseUser.id).maybeSingle(),
        supabase.from("user_permissions").select("permission_key").eq("user_id", supabaseUser.id),
      ]);

      return {
        id: supabaseUser.id,
        email: profile?.email || supabaseUser.email || "",
        name: profile?.name || fallbackName,
        role: roleData?.role || "custom",
        permissions: permsData?.map((p) => p.permission_key) || [],
        phone: profile?.phone || "",
        active: profile?.active ?? true,
      };
    } catch (err) {
      console.error("Error fetching user details:", err);
      appendAgentDebugLog(
        "auth.fetch_user_details_error",
        { userId: supabaseUser.id, message: err instanceof Error ? err.message : String(err) },
        "error",
      );
      return {
        id: supabaseUser.id,
        email: supabaseUser.email || "",
        name: fallbackName,
        role: "custom",
        permissions: [],
        phone: "",
        active: true,
      };
    }
  };

  const refreshUser = async () => {
    if (!user) return;
    setLoading(true);
    const details = await fetchUserDetails(user);
    setAuthUser(details);
    setLoading(false);
  };

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (sessionUser: User | null) => {
      if (!isMounted) return;

      if (sessionUser) {
        const currentAuthUser = authUserRef.current;
        // If same user is already fully loaded, skip refetch
        if (currentAuthUser?.id === sessionUser.id && currentAuthUser.role !== "custom") {
          setUser(sessionUser);
          setLoading(false);
          return;
        }
        if (loadingUserDetailsForRef.current === sessionUser.id) {
          setUser(sessionUser);
          return;
        }
        // Fetch ALL user data before rendering UI
        loadingUserDetailsForRef.current = sessionUser.id;
        window.setTimeout(() => {
          void (async () => {
            const details = await fetchUserDetails(sessionUser);
            loadingUserDetailsForRef.current = null;
            if (!isMounted) return;
            setUser(sessionUser);
            setAuthUser(details);
            setLoading(false);
          })();
        }, 0);
      } else {
        setUser(null);
        setAuthUser(null);
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      appendAgentDebugLog("auth.state_change", {
        event,
        hasSession: !!session,
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });
      if (event === "TOKEN_REFRESHED" && session?.user) {
        const currentAuthUser = authUserRef.current;
        setUser(session.user);
        if (currentAuthUser?.id === session.user.id && currentAuthUser.role !== "custom") {
          setLoading(false);
          return;
        }
      }
      void syncAuthState(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      appendAgentDebugLog("auth.initial_session", {
        hasSession: !!session,
        userId: session?.user?.id || null,
        email: session?.user?.email || null,
      });
      void syncAuthState(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    appendAgentDebugLog("auth.sign_in_start", { email });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      appendAgentDebugLog("auth.sign_in_error", { email, message: error.message }, "error");
      return { error: error.message };
    }
    appendAgentDebugLog("auth.sign_in_success", { email });
    return { error: null };
  };

  const signOut = async () => {
    appendAgentDebugLog("auth.sign_out_start", { userId: user?.id || null });
    await supabase.auth.signOut();
    setUser(null);
    setAuthUser(null);
  };

  const hasPermission = (key: string) => {
    if (!authUser) return false;
    if (authUser.role === "admin") return true;
    return authUser.permissions.includes(key);
  };

  return (
    <AuthContext.Provider
      value={{ user, authUser, loading, signIn, signOut, hasPermission, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
