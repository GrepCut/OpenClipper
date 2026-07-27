import { Text, VStack } from "@chakra-ui/react";
import { useTheme } from "../../../theme";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { TranscriptionSection } from "./settings/transcription-section.component";

export function ClipperHomeSettingsView() {
  const { theme } = useTheme();

  return (
    <VStack align="stretch" gap={10}>
      <VStack align="start" gap={2} maxW="720px">
        <SecondaryMainTitle
          fontSize={{ base: "2xl", md: "3xl" }}
          fontWeight="semibold"
          letterSpacing="-0.03em"
        >
          Settings
        </SecondaryMainTitle>
        <Text color={theme.text.muted} fontSize="md" lineHeight="1.6" maxW="36em">
          Manage the local speech model used for captions.
        </Text>
      </VStack>

      <TranscriptionSection variant="flat" />
    </VStack>
  );
}
