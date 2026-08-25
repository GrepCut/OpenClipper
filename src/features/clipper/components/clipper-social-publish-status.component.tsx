import { Box, Progress, Text } from "@chakra-ui/react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

export function ClipperSocialPublishStatus({
  isPublishing,
  uploadPhase,
  uploadProgress,
  platformLabel,
}: {
  isPublishing: boolean;
  uploadPhase: "uploading" | "publishing";
  uploadProgress: number;
  platformLabel: string;
}) {
  const { theme } = useClipperUi();

  if (!isPublishing) return null;

  return (
    <Box>
      <Text fontSize="xs" mb={2} color={theme.text.muted}>
        {uploadPhase === "uploading"
          ? `Uploading video… ${Math.round(uploadProgress * 100)}%`
          : `Publishing to ${platformLabel}…`}
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
