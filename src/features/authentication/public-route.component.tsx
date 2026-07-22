import { Navigate } from "react-router-dom";
import { useAuth } from "../../shared/hooks/use-auth.hook";

import { ProjectLoadingScreen } from "../../shared/components/project-loading-screen.component";

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
