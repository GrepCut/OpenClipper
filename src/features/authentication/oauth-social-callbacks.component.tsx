import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLoader } from "../../shared/components/app-loader.component";
import { socialAuthService } from "../../services/social-auth.service";
import type {
  SocialOAuthFlow,
  SocialPublishablePlatform,
} from "../../services/types/social-auth.types";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { isTauri } from "../../shared/utils/platform.util";
import { useSocialStore } from "../../stores/use-social-store.store";
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
import { logIntegration } from "../../shared/utils/integration-logger.util";

const FLOW_VERIFY_PLATFORMS: Record<
  SocialOAuthFlow,
  SocialPublishablePlatform[]
> = {
  youtube: ["youtube"],
  meta: ["facebook", "instagram"],
  instagram: ["instagram"],
  tiktok: ["tiktok"],
  x: ["x"],
};

const FLOW_LABELS: Record<SocialOAuthFlow, string> = {
  youtube: "YouTube",
  meta: "Meta",
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X",
};

export function createSocialOAuthCallback(flow: SocialOAuthFlow) {
  return function SocialOAuthCallback() {
    const navigate = useNavigate();
    const location = useLocation();
    const { checkAuthStatus, completeDesktopLogin } = useAuth();
    const { theme } = useTheme();
    const callbackStartedRef = useRef(false);
    const [status, setStatus] = useState<OAuthConnectionStatus>("connecting");
    const [errorMessage, setErrorMessage] = useState("");
    const label = FLOW_LABELS[flow];

    const verifyConnection = useCallback(async (): Promise<boolean> => {
      if (flow === "meta") {
        const targets = await socialAuthService.getMetaTargets();
        if (targets.selectionRequired) return true;
      }
      const platforms = FLOW_VERIFY_PLATFORMS[flow];
      let anyConnected = false;
      for (const platform of platforms) {
        const statusResponse = await socialAuthService.checkConnection(platform);
        useSocialStore
          .getState()
          .setConnections(platform, statusResponse.connections ?? []);
        if (statusResponse.connected) anyConnected = true;
      }
      if (!anyConnected) {
        throw new Error(`${label} connection verification failed`);
      }
      return false;
    }, [flow, label]);

    const handleCallback = useCallback(async () => {
      if (callbackStartedRef.current) return;
      callbackStartedRef.current = true;

      try {
        const {
          ticket,
          error: callbackError,
          returnPath,
        } = parseOAuthSearchParams(location.search);

        logIntegration("oauth.callback_page_opened", {
          flow,
          hasTicket: Boolean(ticket),
          callbackError,
          returnPath,
          search: location.search,
        });

        if (callbackError) throw new Error(callbackError);

        setStatus("connecting");

        if (isTauri() && ticket) {
          await exchangeDesktopTicketIfNeeded(
            ticket,
            { completeDesktopLogin, checkAuthStatus },
            () => setStatus("verifying"),
          );
        }

        setStatus("verifying");
        const selectionRequired = await verifyConnection();

        logIntegration("oauth.callback_verified", {
          flow,
          selectionRequired,
        });

        handleOAuthConnectionSuccess(
          navigate,
          resolveOAuthReturnPath(returnPath, location.search),
          selectionRequired
            ? "Choose your Facebook Page to finish connecting Meta."
            : `${label} connected successfully!`,
          setStatus,
        );
      } catch (error: unknown) {
        logIntegration("oauth.callback_failed", {
          flow,
          error: error instanceof Error ? error.message : String(error),
        });
        handleOAuthConnectionFailure(
          navigate,
          error,
          `Failed to connect ${label}`,
          `/clipper?error=${flow}_connection_failed`,
          setStatus,
          setErrorMessage,
        );
      }
    }, [
      location.search,
      completeDesktopLogin,
      checkAuthStatus,
      navigate,
      verifyConnection,
      label,
    ]);

    useEffect(() => {
      void handleCallback();
    }, [handleCallback]);

    const getLayoutProps = () => {
      switch (status) {
        case "success":
          return {
            title: "Successfully connected!",
            description: `Your ${label} account has been linked.`,
            statusColor: theme.status.success,
          };
        case "error":
          return {
            title: "Connection failed",
            description: errorMessage || "An error occurred during connection.",
            statusColor: theme.status.error,
          };
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
  };
}

export const OAuthMetaCallback = createSocialOAuthCallback("meta");
export const OAuthInstagramCallback = createSocialOAuthCallback("instagram");
export const OAuthTikTokCallback = createSocialOAuthCallback("tiktok");
export const OAuthXCallback = createSocialOAuthCallback("x");
