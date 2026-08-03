import { Text, VStack } from "@chakra-ui/react";
import { useTheme } from "../../../theme";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { TranscriptionSection } from "./settings/transcription-section.component";
import { AppUpdateCard } from "../../settings/app-update-card.component";

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
          Choose a local or cloud speech-to-text provider for captions. Cloud providers use your own API keys stored locally in SQLite.
        </Text>
      </VStack>

      <AppUpdateCard />
      <TranscriptionSection variant="flat" />
    </VStack>
  );
}
