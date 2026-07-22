import { useAuthStore } from "../stores/use-auth-store.store";

export function useAuth() {
  return useAuthStore();
}
