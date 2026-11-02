import { useAuth } from "../auth/AuthProvider";

export function useRestaurantId(): string | null {
  const { activeMembership } = useAuth();
  return activeMembership?.restaurant.id ?? null;
}
