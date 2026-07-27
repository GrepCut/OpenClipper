import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLoader } from "../../shared/components/app-loader.component";
import { googleAuthService } from "../../services/google-auth.service";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { isTauri } from "../../shared/utils/platform.util";
import { useTheme } from "../../theme";
import { OAuthProcessingLayout } from "./components/oauth-processing-layout.component";
import {
  exchangeDesktopTicketIfNeeded,
  handleOAuthConnectionFailure,
  handleOAuthConnectionSuccess,
  parseOAuthSearchParams,
  resolveOAuthReturnPath,
  type OAuthConnectionStatus,
} from "./oauth-callback-utils.util";

export function OAuthDriveCallback() {
  const navigate = useNavigate();
  const location = useLocation();
  const { checkAuthStatus, completeDesktopLogin } = useAuth();
  const { theme } = useTheme();

  const [status, setStatus] = useState<OAuthConnectionStatus>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleCallback = useCallback(async () => {
    try {
      const { ticket, error: callbackError, returnPath } = parseOAuthSearchParams(
        location.search,
      );

      if (callbackError) throw new Error(callbackError);

      setStatus("connecting");

      if (isTauri() && ticket) {
        await exchangeDesktopTicketIfNeeded(
          ticket,
          { completeDesktopLogin, checkAuthStatus },
          () => setStatus("verifying"),
        );
      } else {
        const tokenResponse = await googleAuthService.getAccessToken();
        if (!tokenResponse.success || !tokenResponse.data?.accessToken) {
          throw new Error("No access token received from refresh");
        }
      }

      setStatus("verifying");
      const isConnected = await googleAuthService.checkDriveConnection();

      if (!isConnected) {
        throw new Error("Google Drive connection verification failed");
      }

      handleOAuthConnectionSuccess(
        navigate,
        resolveOAuthReturnPath(returnPath, location.search),
        "Google Drive connected successfully!",
        setStatus,
      );
    } catch (error: unknown) {
      handleOAuthConnectionFailure(
        navigate,
        error,
        "Failed to connect Google Drive",
        "/clipper?error=google_drive_connection_failed",
        setStatus,
        setErrorMessage,
      );
    }
  }, [location.search, completeDesktopLogin, checkAuthStatus, navigate]);

  useEffect(() => {
    void handleCallback();
  }, [handleCallback]);

  const getLayoutProps = () => {
    switch (status) {
      case "success":
        return {
          title: "Successfully connected!",
          description: "Your Google Drive has been linked to your account.",
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
    <OAuthProcessingLayout {...getLayoutProps()} showProgressBar={status !== "error" && status !== "success"}>
      {status !== "error" && status !== "success" && (
        <AppLoader size="xl" centered={false} />
      )}
    </OAuthProcessingLayout>
  );
}
