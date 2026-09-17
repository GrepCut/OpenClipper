import { useEffect, useState } from "react";
import {
  socialAuthService,
  type TikTokCreatorInfo,
  type TikTokPrivacyLevel,
} from "../../../services/social-auth.service";
import { isTikTokPublishReady } from "../shared/clipper-tiktok-publish.util";

export function useClipperTikTokPublishForm({
  isOpen,
  enabled,
  defaultConnected,
  connectionId,
}: {
  isOpen: boolean;
  enabled: boolean;
  defaultConnected: boolean;
  connectionId: string | null;
}) {
  const [tiktokCreator, setTikTokCreator] = useState<TikTokCreatorInfo | null>(null);
  const [tiktokPrivacy, setTikTokPrivacy] = useState<TikTokPrivacyLevel | "">("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [commercialDisclosure, setCommercialDisclosure] = useState(false);
  const [brandContent, setBrandContent] = useState(false);
  const [brandOrganic, setBrandOrganic] = useState(false);
  const [isAigc, setIsAigc] = useState(false);
  const [musicUsageConfirmed, setMusicUsageConfirmed] = useState(false);
  const [tiktokError, setTikTokError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setTikTokPrivacy("");
    setAllowComment(false);
    setAllowDuet(false);
    setAllowStitch(false);
    setCommercialDisclosure(false);
    setBrandContent(false);
    setBrandOrganic(false);
    setIsAigc(false);
    setMusicUsageConfirmed(false);
    setTikTokError(null);
    setTikTokCreator(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !enabled || !defaultConnected || !connectionId) return;
    let cancelled = false;
    void socialAuthService.getTikTokCreatorInfo(connectionId)
      .then((creator) => { if (!cancelled) setTikTokCreator(creator); })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTikTokError(error instanceof Error ? error.message : "Could not load TikTok account settings.");
        }
      });
    return () => { cancelled = true; };
  }, [isOpen, enabled, defaultConnected, connectionId]);

  useEffect(() => {
    if (tiktokCreator?.commentDisabled) setAllowComment(false);
    if (tiktokCreator?.duetDisabled) setAllowDuet(false);
    if (tiktokCreator?.stitchDisabled) setAllowStitch(false);
  }, [tiktokCreator]);

  const handleCommercialDisclosureChange = (value: boolean) => {
    setCommercialDisclosure(value);
    if (!value) {
      setBrandContent(false);
      setBrandOrganic(false);
    }
  };

  const handleBrandContentChange = (value: boolean) => {
    setBrandContent(value);
  };

  return {
    tiktokCreator,
    tiktokPrivacy,
    setTikTokPrivacy,
    allowComment,
    setAllowComment,
    allowDuet,
    setAllowDuet,
    allowStitch,
    setAllowStitch,
    commercialDisclosure,
    setCommercialDisclosure: handleCommercialDisclosureChange,
    brandContent,
    setBrandContent: handleBrandContentChange,
    brandOrganic,
    setBrandOrganic,
    isAigc,
    setIsAigc,
    musicUsageConfirmed,
    setMusicUsageConfirmed,
    tiktokError,
    tiktokReady: isTikTokPublishReady({
      privacyLevel: tiktokPrivacy,
      musicUsageConfirmed,
      creator: tiktokCreator,
      commercialDisclosure,
      brandOrganic,
      brandContent,
    }),
  };
}
