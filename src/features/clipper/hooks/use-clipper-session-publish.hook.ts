import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { youtubeAuthService } from "../../../services/youtube-auth.service";
import {
  oauthFlowForPlatform,
  socialAuthService,
  type SocialConnectionSummary,
  type SocialPublishablePlatform,
} from "../../../services/social-auth.service";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { appToast } from "../../../shared/utils/toast.service";
import { useSocialStore } from "../../../stores/use-social-store.store";
import { useYoutubeStore } from "../../../stores/use-youtube-store.store";
import type { ClipperPublishTarget } from "../components/clipper-export-format-row.component";
import type { OwnerPublishConnectionResult } from "../shared/clipper-owner-channels.util";
import {
  resolveProjectOwnerPublishConnection,
  showOwnerPublishBlockedToast,
} from "../shared/resolve-owner-publish-connection.util";
import type { ClipperFormatResult } from "../shared/state.util";
import { logYoutubeDebug } from "../shared/youtube-debug.util";

export interface UseClipperSessionPublishOptions {
  projectId: string;
  canUseAccountFeatures: boolean;
}

export function useClipperSessionPublish({
  projectId,
  canUseAccountFeatures,
}: UseClipperSessionPublishOptions) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();

  const [queuePublishTarget, setQueuePublishTarget] = useState<ClipperFormatResult | null>(null);
  const [queuePublishTargetPlatform, setQueuePublishTargetPlatform] =
    useState<ClipperPublishTarget>("youtube");
  const [queuePublishConnectionOverride, setQueuePublishConnectionOverride] =
    useState<OwnerPublishConnectionResult | null>(null);

  const youtubeConnections = useYoutubeStore((s) => s.connections);
  const refreshYoutubeStatus = useYoutubeStore((s) => s.refreshStatus);
  const socialPlatforms = useSocialStore((s) => s.platforms);
  const refreshSocial = useSocialStore((s) => s.refreshAll);

  const requestAccount = useCallback(() => {
    if (auth.user && auth.isAuthenticated) {
      appToast.error("Account offline", "Connect to the internet to use this feature.");
      return false;
    }
    rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
    navigate("/auth");
    return false;
  }, [auth.isAuthenticated, auth.user, location.hash, location.pathname, location.search, navigate]);

  const handleRequestConnect = useCallback(
    (platform: SocialPublishablePlatform) => {
      if (!canUseAccountFeatures) return;
      const returnPath = `${window.location.pathname}${window.location.search}`;
      const flow = oauthFlowForPlatform(platform);
      if (flow === "youtube") {
        logYoutubeDebug("ClipperSessionView: initiating YouTube connect", {
          returnPath,
          projectId,
        });
        void youtubeAuthService.redirectToYoutubeConnect(returnPath).catch((error) => {
          console.error(
            "[Clipper/YouTube] ClipperSessionView: redirectToYoutubeConnect failed",
            error,
          );
        });
        return;
      }
      void socialAuthService.redirectToConnect(flow, returnPath);
    },
    [canUseAccountFeatures, projectId],
  );

  const queuePublishPlatform: SocialPublishablePlatform = useMemo(() => {
    if (!queuePublishTarget) return "youtube";
    return queuePublishTargetPlatform;
  }, [queuePublishTarget, queuePublishTargetPlatform]);

  const queuePublishConnection = useMemo(() => {
    if (queuePublishConnectionOverride) {
      return {
        connected: queuePublishConnectionOverride.connected,
        accountLabel: queuePublishConnectionOverride.accountLabel,
        accountConnections: queuePublishConnectionOverride.accountConnections,
        ownerChannelLabel: queuePublishConnectionOverride.ownerChannelLabel,
      };
    }

    const connections: SocialConnectionSummary[] =
      queuePublishPlatform === "youtube"
        ? youtubeConnections
        : socialPlatforms[queuePublishPlatform]?.connections ?? [];

    return {
      connected: connections.length > 0,
      accountLabel: connections[0]?.displayName ?? null,
      accountConnections: connections,
      ownerChannelLabel: null,
    };
  }, [
    queuePublishConnectionOverride,
    queuePublishPlatform,
    youtubeConnections,
    socialPlatforms,
  ]);

  useEffect(() => {
    if (!canUseAccountFeatures) return;
    void refreshYoutubeStatus();
    void refreshSocial();
  }, [canUseAccountFeatures, refreshYoutubeStatus, refreshSocial]);

  const openPublishDialog = useCallback(
    (result: ClipperFormatResult, target: ClipperPublishTarget) => {
      if (result.isMissing) return;
      if (!canUseAccountFeatures) {
        requestAccount();
        return;
      }

      void (async () => {
        const ownerConnection = await resolveProjectOwnerPublishConnection({
          projectId,
          platform: target,
          youtubeConnections,
          socialPlatforms,
        });
        if (ownerConnection) {
          if (showOwnerPublishBlockedToast(target, ownerConnection)) {
            return;
          }
          setQueuePublishConnectionOverride(ownerConnection);
        } else {
          setQueuePublishConnectionOverride(null);
        }
        setQueuePublishTargetPlatform(target);
        setQueuePublishTarget(result);
      })();
    },
    [
      canUseAccountFeatures,
      projectId,
      requestAccount,
      socialPlatforms,
      youtubeConnections,
    ],
  );

  const closePublishDialog = useCallback(() => {
    setQueuePublishTarget(null);
    setQueuePublishConnectionOverride(null);
  }, []);

  return {
    queuePublishTarget,
    queuePublishPlatform,
    queuePublishConnection,
    requestAccount,
    handleRequestConnect,
    openPublishDialog,
    closePublishDialog,
  };
}
