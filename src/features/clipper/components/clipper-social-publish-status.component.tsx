import { Box, Progress, Text } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import type { SocialPublishUploadPhase } from "../shared/run-clipper-social-publish.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

function phaseLabel(
  uploadPhase: SocialPublishUploadPhase,
  uploadProgress: number,
  platformLabel: string,
): string {
  if (uploadPhase === "preparing") return "Preparing file…";
  if (uploadPhase === "uploading") {
    return `Uploading video… ${Math.round(uploadProgress * 100)}%`;
  }
  return `Publishing to ${platformLabel}…`;
}

export function ClipperSocialPublishStatus({
  isPublishing,
  uploadPhase,
  uploadProgress,
  platformLabel,
}: {
  isPublishing: boolean;
  uploadPhase: SocialPublishUploadPhase;
  uploadProgress: number;
  platformLabel: string;
}) {
  const { theme } = useClipperUi();

  if (!isPublishing) return null;

  return (
    <Box>
      <Text fontSize="xs" mb={2} color={theme.text.muted}>
        {phaseLabel(uploadPhase, uploadProgress, platformLabel)}
      </Text>
      <Progress.Root
        value={uploadPhase === "uploading" ? uploadProgress * 100 : null}
        max={100}
      >
        <Progress.Track borderRadius="full" bg={theme.surface.hover}>
          <Progress.Range bg={clipperTheme.accent} />
        </Progress.Track>
      </Progress.Root>
    </Box>
  );
}
