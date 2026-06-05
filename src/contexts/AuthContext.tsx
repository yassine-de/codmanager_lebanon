import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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
const AUTH_USER_CACHE_KEY = "codmanager:lastAuthUser";

function getCachedAuthUser(userId: string): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as AuthUser;
    return cached?.id === userId && cached.role !== "custom" ? cached : null;
  } catch {
    return null;
  }
}

function cacheAuthUser(details: AuthUser) {
  if (details.role === "custom") return;
  try {
    localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(details));
  } catch {
    // Storage can be unavailable in private mode; auth still works without cache.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const authUserRef = useRef<AuthUser | null>(null);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  const fetchUserDetails = async (supabaseUser: User): Promise<AuthUser> => {
    const fallbackName =
      typeof supabaseUser.user_metadata?.name === "string" && supabaseUser.user_metadata.name.trim().length > 0
        ? supabaseUser.user_metadata.name
        : supabaseUser.email?.split("@")[0] || "User";

    const [profileResult, roleResult, permsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", supabaseUser.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", supabaseUser.id).maybeSingle(),
      supabase.from("user_permissions").select("permission_key").eq("user_id", supabaseUser.id),
    ]);

    if (profileResult.error || roleResult.error || permsResult.error) {
      throw profileResult.error || roleResult.error || permsResult.error;
    }

    const details = {
      id: supabaseUser.id,
      email: profileResult.data?.email || supabaseUser.email || "",
      name: profileResult.data?.name || fallbackName,
      role: roleResult.data?.role || "custom",
      permissions: permsResult.data?.map((p) => p.permission_key) || [],
      phone: profileResult.data?.phone || "",
      active: profileResult.data?.active ?? true,
    };

    cacheAuthUser(details);
    return details;
  };

  const refreshUser = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const details = await fetchUserDetails(user);
      setAuthUser(details);
    } catch (err) {
      console.error("Error refreshing user details:", err);
      const cached = authUserRef.current?.id === user.id ? authUserRef.current : getCachedAuthUser(user.id);
      if (cached) setAuthUser(cached);
    }
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
        // Fetch ALL user data before rendering UI
        let details: AuthUser;
        try {
          details = await fetchUserDetails(sessionUser);
        } catch (err) {
          console.error("Error fetching user details:", err);
          const cached = getCachedAuthUser(sessionUser.id);
          details = cached || {
            id: sessionUser.id,
            email: sessionUser.email || "",
            name: sessionUser.user_metadata?.name || sessionUser.email?.split("@")[0] || "User",
            role: "custom",
            permissions: [],
            phone: "",
            active: true,
          };
        }
        if (!isMounted) return;
        setUser(sessionUser);
        setAuthUser(details);
        setLoading(false);
      } else {
        setUser(null);
        setAuthUser(null);
        setLoading(false);
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncAuthState(session?.user ?? null);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
      void syncAuthState(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(AUTH_USER_CACHE_KEY);
    } catch {}
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
