import { useEffect } from "react";
import { useAppUpdateStore } from "../../stores/use-app-update.store";

export function AppUpdateInitializer({
  children,
}: {
  children: React.ReactNode;
}) {
  const initialize = useAppUpdateStore((state) => state.initialize);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  return <>{children}</>;
}
