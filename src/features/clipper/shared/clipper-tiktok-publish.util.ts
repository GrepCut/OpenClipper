import type { TikTokCreatorInfo, TikTokPrivacyLevel } from "../../../services/social-auth.service";

export const TIKTOK_TITLE_MAX_LENGTH = 2200;

export const TIKTOK_MUSIC_USAGE_COPY =
  "By posting, you agree to TikTok's Music Usage Confirmation";

export const TIKTOK_BRANDED_POLICY_COPY =
  "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation";

export const TIKTOK_COMMERCIAL_REQUIRE_HINT =
  "You need to indicate if your content promotes yourself, a third party, or both.";

export const TIKTOK_BRANDED_PRIVATE_HINT =
  "Branded content visibility cannot be set to private.";

export const TIKTOK_PROCESSING_NOTICE =
  "After you publish, it may take a few minutes for the content to process and be visible on your profile.";

export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export function tiktokConsentCopy(brandContent: boolean): string {
  return brandContent ? TIKTOK_BRANDED_POLICY_COPY : TIKTOK_MUSIC_USAGE_COPY;
}

export function tiktokCommercialLabelCopy(params: {
  brandOrganic: boolean;
  brandContent: boolean;
}): string | null {
  if (params.brandContent) {
    return "Your photo/video will be labeled as 'Paid partnership'";
  }
  if (params.brandOrganic) {
    return "Your photo/video will be labeled as 'Promotional content'";
  }
  return null;
}

export function formatTikTokBlockerMessage(message?: string): string {
  const base = message?.trim() || "TikTok cannot accept a post now.";
  return /try again later/i.test(base) ? base : `${base} Try again later.`;
}

export function isTikTokCommercialComplete(params: {
  commercialDisclosure: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
}): boolean {
  if (!params.commercialDisclosure) return true;
  return params.brandOrganic || params.brandContent;
}

export function isTikTokBrandedPrivateConflict(params: {
  brandContent: boolean;
  privacyLevel: TikTokPrivacyLevel | "";
}): boolean {
  return params.brandContent && params.privacyLevel === "SELF_ONLY";
}

export function isTikTokPublishReady(params: {
  privacyLevel: TikTokPrivacyLevel | "";
  musicUsageConfirmed: boolean;
  creator: TikTokCreatorInfo | null;
  commercialDisclosure: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
}): boolean {
  return Boolean(
    params.privacyLevel
      && params.musicUsageConfirmed
      && params.creator?.canPost
      && isTikTokCommercialComplete(params)
      && !isTikTokBrandedPrivateConflict(params),
  );
}
