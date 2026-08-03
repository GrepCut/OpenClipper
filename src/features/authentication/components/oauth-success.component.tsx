import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { appToast } from "../../../shared/utils/toast.service";
import { isTauri } from "../../../shared/utils/platform.util";
import { OAuthProcessingLayout } from "./oauth-processing-layout.component";
import { exchangeDesktopTicketIfNeeded } from "./oauth-callback-utils.util";
import { trackEvent } from "../../../lib/analytics.util";
import { consumeAuthReturnPath } from "../../../shared/auth/auth-return-path.util";

export function OAuthSuccess() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAuthStatus, completeDesktopLogin } = useAuth();
  const hasRun = useRef(false);

  const ticket = useMemo(
    () => new URLSearchParams(location.search).get("ticket"),
    [location.search],
  );

  const intentToken = useMemo(
    () => new URLSearchParams(location.search).get("intent"),
    [location.search],
  );

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    void finalizeOAuth();
  }, [ticket, intentToken]);

  const finalizeOAuth = async () => {
    try {
      if (isTauri() && ticket) {
        await handleTauriLogin(ticket);
      } else {
        await checkAuthStatus();
      }

      trackEvent("login");

      appToast.success(
        "Logged in successfully",
        "Welcome to the application! You can now manage your projects."
      );

      if (intentToken) {
        appToast.error(
          "Subscription error",
          "Subscription checkout is not available in Clipper.",
          { duration: 5000 }
        );
      }

      navigate(consumeAuthReturnPath(), { replace: true });
    } catch (error) {
      handleLoginError();
    }
  };

  const handleTauriLogin = async (authTicket: string) => {
    await exchangeDesktopTicketIfNeeded(authTicket, {
      completeDesktopLogin,
      checkAuthStatus,
    });
  };

  const handleLoginError = () => {
    appToast.error(
      "Login error",
      "Failed to finalize login. Try again.",
      { duration: 5000 }
    );
    navigate("/auth", { replace: true });
  };

  return (
    <OAuthProcessingLayout />
  );
}
