import { useEffect } from "react";
import { useAuth } from "../../shared/hooks/use-auth.hook";

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { ensureAuthLoaded } = useAuth();

  useEffect(() => {
    ensureAuthLoaded();
  }, [ensureAuthLoaded]);

  return <>{children}</>;
}
