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
  authError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasPermission: (key: string) => boolean;
  refreshUser: () => Promise<void>;
  retryAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const AUTH_RETRY_DELAYS_MS = [0, 800, 1600, 3000, 5000];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const authUserRef = useRef<AuthUser | null>(null);
  const userRef = useRef<User | null>(null);
  const signingOutRef = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

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

    return {
      id: supabaseUser.id,
      email: profileResult.data?.email || supabaseUser.email || "",
      name: profileResult.data?.name || fallbackName,
      role: roleResult.data?.role || "custom",
      permissions: permsResult.data?.map((p) => p.permission_key) || [],
      phone: profileResult.data?.phone || "",
      active: profileResult.data?.active ?? true,
    };
  };

  const fetchUserDetailsWithRetry = async (supabaseUser: User): Promise<AuthUser> => {
    let lastError: unknown;

    for (const delayMs of AUTH_RETRY_DELAYS_MS) {
      if (delayMs > 0) await wait(delayMs);

      try {
        return await fetchUserDetails(supabaseUser);
      } catch (err) {
        lastError = err;
        console.warn("Retrying user details after auth load error:", err);
      }
    }

    throw lastError;
  };

  const refreshUser = async () => {
    if (!user) return;
    setLoading(true);
    setAuthError(null);
    try {
      const details = await fetchUserDetailsWithRetry(user);
      setAuthUser(details);
    } catch (err) {
      console.error("Error refreshing user details:", err);
      setAuthError("We couldn't load your account permissions. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const retryAuth = async () => {
    setLoading(true);
    setAuthError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const sessionUser = session?.user ?? null;
    if (!sessionUser) {
      if (!userRef.current) {
        setUser(null);
        setAuthUser(null);
      }
      setAuthError("We couldn't restore your session. Please check your connection and try again.");
      setLoading(false);
      return;
    }

    try {
      const details = await fetchUserDetailsWithRetry(sessionUser);
      setUser(sessionUser);
      setAuthUser(details);
    } catch (err) {
      console.error("Error retrying auth load:", err);
      setUser(sessionUser);
      setAuthUser(null);
      setAuthError("We couldn't load your account permissions. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const syncAuthState = async (sessionUser: User | null) => {
      if (!isMounted) return;

      if (sessionUser) {
        setLoading(true);
        setAuthError(null);
        setUser(sessionUser);
        const currentAuthUser = authUserRef.current;
        // If same user is already fully loaded, skip refetch
        if (currentAuthUser?.id === sessionUser.id && currentAuthUser.role !== "custom") {
          setLoading(false);
          return;
        }
        // Fetch ALL user data before rendering UI
        let details: AuthUser;
        try {
          details = await fetchUserDetailsWithRetry(sessionUser);
        } catch (err) {
          console.error("Error fetching user details:", err);
          if (!isMounted) return;
          setUser(sessionUser);
          setAuthUser(null);
          setAuthError("We couldn't load your account permissions. Please check your connection and try again.");
          setLoading(false);
          return;
        }
        if (!isMounted) return;
        setUser(sessionUser);
        setAuthUser(details);
        setLoading(false);
      } else {
        if (!signingOutRef.current && userRef.current) {
          setLoading(true);

          for (const delayMs of [800, 1600, 3000]) {
            await wait(delayMs);
            const {
              data: { session },
            } = await supabase.auth.getSession();

            if (session?.user) {
              void syncAuthState(session.user);
              return;
            }
          }

          setAuthError("We couldn't restore your session. Please check your connection and try again.");
          setLoading(false);
          return;
        }

        setUser(null);
        setAuthUser(null);
        setAuthError(null);
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
    signingOutRef.current = true;
    await supabase.auth.signOut();
    setUser(null);
    setAuthUser(null);
    setAuthError(null);
    signingOutRef.current = false;
  };

  const hasPermission = (key: string) => {
    if (!authUser) return false;
    if (authUser.role === "admin") return true;
    return authUser.permissions.includes(key);
  };

  return (
    <AuthContext.Provider
      value={{ user, authUser, loading, authError, signIn, signOut, hasPermission, refreshUser, retryAuth }}
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
