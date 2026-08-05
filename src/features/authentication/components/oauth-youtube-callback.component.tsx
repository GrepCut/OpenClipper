import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { isTauri } from "../../../shared/utils/platform.util";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import { useTheme } from "../../../theme";
import { OAuthProcessingLayout } from "./oauth-processing-layout.component";
import {
  exchangeDesktopTicketIfNeeded,
  handleOAuthConnectionFailure,
  handleOAuthConnectionSuccess,
  parseOAuthSearchParams,
  resolveOAuthReturnPath,
  type OAuthConnectionStatus,
} from "./oauth-callback-utils.util";

export function OAuthYoutubeCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAuthStatus, completeDesktopLogin } = useAuth();
  const { theme } = useTheme();
  const callbackStartedRef = useRef(false);

  const [status, setStatus] = useState<OAuthConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const verifyYoutubeConnection = useCallback(async () => {
    console.log("[YouTube Auth] Verifying YouTube connection after OAuth…");
    const statusResponse = await youtubeAuthService.checkYoutubeConnection();
    console.log("[YouTube Auth] Verification status response", statusResponse);
    useYoutubeStore.getState().setConnections(statusResponse.connections ?? []);

    if (!statusResponse.connected) {
      console.error("[YouTube Auth] Verification failed: connected=false", statusResponse);
      const reasonHint =
        statusResponse.reason === "no_refresh_token"
          ? "No YouTube refresh token is stored for this account."
          : statusResponse.reason === "api_check_failed"
            ? "YouTube API rejected the stored credentials."
            : undefined;
      throw new Error(
        reasonHint
          ? `YouTube connection verification failed: ${reasonHint}`
          : "YouTube connection verification failed",
      );
    }
    console.log("[YouTube Auth] Verification succeeded", {
      channelTitle: statusResponse.channelTitle ?? null,
    });
  }, []);

  const handleCallback = useCallback(async () => {
    if (callbackStartedRef.current) {
      return;
    }
    callbackStartedRef.current = true;

    try {
      const { ticket, error: callbackError, returnPath } = parseOAuthSearchParams(
        location.search,
      );

      console.log("[YouTube Auth] OAuth callback started", {
        pathname: location.pathname,
        search: location.search,
        ticket: ticket ? `${ticket.slice(0, 8)}…` : null,
        callbackError,
        returnPath,
        isTauri: isTauri(),
      });

      if (callbackError) throw new Error(callbackError);

      setStatus("connecting");

      if (isTauri() && ticket) {
        console.log("[YouTube Auth] Exchanging desktop ticket before verification");
        await exchangeDesktopTicketIfNeeded(
          ticket,
          { completeDesktopLogin, checkAuthStatus },
          () => setStatus("verifying"),
        );
      }

      setStatus("verifying");
      await verifyYoutubeConnection();

      handleOAuthConnectionSuccess(
        navigate,
        resolveOAuthReturnPath(returnPath, location.search),
        "YouTube channel connected successfully!",
        setStatus,
      );
    } catch (error: unknown) {
      console.error("[YouTube Auth] OAuth callback failed", error);
      handleOAuthConnectionFailure(
        navigate,
        error,
        "Failed to connect YouTube",
        "/clipper?error=youtube_connection_failed",
        setStatus,
        setErrorMessage,
      );
    }
  }, [
    location.pathname,
    location.search,
    completeDesktopLogin,
    checkAuthStatus,
    navigate,
    verifyYoutubeConnection,
  ]);

  useEffect(() => {
    void handleCallback();
  }, [handleCallback]);

  const getLayoutProps = () => {
    switch (status) {
      case "success":
        return {
          title: "Successfully connected!",
          description: "Your YouTube channel has been linked to your account.",
          statusColor: theme.status.success,
        };
      case "error":
        return {
          title: "Connection failed",
          description: errorMessage || "An error occurred during connection.",
          statusColor: theme.status.error,
        };
      case "verifying":
        return {};
      default:
        return {};
    }
  };

  return (
    <OAuthProcessingLayout
      {...getLayoutProps()}
      showProgressBar={status !== "error" && status !== "success"}
    >
      {status !== "error" && status !== "success" && (
        <AppLoader size="xl" centered={false} />
      )}
    </OAuthProcessingLayout>
  );
}
