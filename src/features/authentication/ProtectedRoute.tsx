import { Navigate } from "react-router-dom";
import { useAuth } from "../../shared/hooks/useAuth";

import { ProjectLoadingScreen } from "../../shared/components/ProjectLoadingScreen";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, hasTriedInit, isLoggingOut } = useAuth();

  // Podczas wylogowywania pokazujemy spinner zamiast natychmiastowego przekierowania
  // To zapobiega "białemu flash" gdy Dashboard jest odmontowywany przed załadowaniem nowego widoku
  if (isLoggingOut) {
    return <ProjectLoadingScreen type="loading" message="Logging out..." />;
  }

  if (!hasTriedInit) {
    return <ProjectLoadingScreen type="loading" message="Verifying session..." />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
