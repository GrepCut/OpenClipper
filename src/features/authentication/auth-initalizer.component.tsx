import { useEffect } from "react";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { useIntegrationsRefreshOnOnline } from "../../shared/hooks/use-integrations-refresh-on-online.hook";

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { ensureAuthLoaded } = useAuth();
  useIntegrationsRefreshOnOnline();

  useEffect(() => {
    ensureAuthLoaded();
  }, [ensureAuthLoaded]);

  return <>{children}</>;
}
