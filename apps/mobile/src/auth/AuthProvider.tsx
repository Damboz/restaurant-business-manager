import type { LoginInput, RegisterInput } from "@rbm/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import {
  clearSession,
  getActiveRestaurantId,
  getCurrentUser,
  hasStoredSession,
  login,
  logout,
  register,
  setActiveRestaurantId,
  type AuthResponse,
  type AuthUser,
  type Membership
} from "../api/client";

type AuthStatus = "loading" | "guest" | "authenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  activeMembership: Membership | null;
  signIn: (input: LoginInput) => Promise<void>;
  signUp: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  selectRestaurant: (membershipId: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function chooseMembership(
  memberships: Membership[],
  preferredId: string | null
): Membership | null {
  return (
    memberships.find((membership) => membership.id === preferredId) ??
    memberships[0] ??
    null
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [activeMembership, setActiveMembership] = useState<Membership | null>(
    null
  );

  const applySession = useCallback(async (response: AuthResponse) => {
    const preferredId = await getActiveRestaurantId();
    const membership = chooseMembership(response.user.memberships, preferredId);

    await setActiveRestaurantId(membership?.id ?? null);
    setUser(response.user);
    setActiveMembership(membership);
    setStatus("authenticated");
  }, []);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      if (!(await hasStoredSession())) {
        if (active) {
          setStatus("guest");
        }
        return;
      }

      try {
        const currentUser = await getCurrentUser();
        const preferredId = await getActiveRestaurantId();
        const membership = chooseMembership(
          currentUser.memberships,
          preferredId
        );

        if (membership && membership.id !== preferredId) {
          await setActiveRestaurantId(membership.id);
        }

        if (active) {
          setUser(currentUser);
          setActiveMembership(membership);
          setStatus("authenticated");
        }
      } catch {
        await clearSession();

        if (active) {
          setUser(null);
          setActiveMembership(null);
          setStatus("guest");
        }
      }
    }

    void restoreSession();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(
    async (input: LoginInput) => {
      const response = await login(input);
      await applySession(response);
    },
    [applySession]
  );

  const signUp = useCallback(
    async (input: RegisterInput) => {
      const response = await register(input);
      await applySession(response);
    },
    [applySession]
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setUser(null);
      setActiveMembership(null);
      setStatus("guest");
    }
  }, []);

  const selectRestaurant = useCallback(
    async (membershipId: string) => {
      const membership = user?.memberships.find(
        (item) => item.id === membershipId
      );

      if (!membership) {
        throw new Error("The selected restaurant is not available");
      }

      await setActiveRestaurantId(membership.id);
      setActiveMembership(membership);
    },
    [user]
  );

  const refreshUser = useCallback(async () => {
    const currentUser = await getCurrentUser();
    const preferredId = activeMembership?.id ?? null;
    const membership = chooseMembership(currentUser.memberships, preferredId);

    if (membership) {
      await setActiveRestaurantId(membership.id);
    }

    setUser(currentUser);
    setActiveMembership(membership);
  }, [activeMembership?.id]);

  const hasPermission = useCallback(
    (permission: string) =>
      activeMembership?.permissions.includes(permission) ?? false,
    [activeMembership]
  );

  const value = useMemo(
    () => ({
      status,
      user,
      activeMembership,
      signIn,
      signUp,
      signOut,
      selectRestaurant,
      refreshUser,
      hasPermission
    }),
    [
      status,
      user,
      activeMembership,
      signIn,
      signUp,
      signOut,
      selectRestaurant,
      refreshUser,
      hasPermission
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
