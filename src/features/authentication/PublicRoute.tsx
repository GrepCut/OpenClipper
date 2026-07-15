import { Navigate } from "react-router-dom";
import { useAuth } from "../../shared/hooks/useAuth";

import { ProjectLoadingScreen } from "../../shared/components/ProjectLoadingScreen";

export function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, hasTriedInit } = useAuth();

  if (!hasTriedInit) {
    return <ProjectLoadingScreen type="loading" message="Verifying session..." />;
  }

  if (user) {
    return <Navigate to="/clipper" replace />;
  }

  return <>{children}</>;
}
