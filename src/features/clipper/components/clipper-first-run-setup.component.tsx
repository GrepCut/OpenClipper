import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useTheme } from "../../../theme";
import { ClipperFirstRunApiKey } from "./clipper-first-run-api-key.component";
import { ClipperFirstRunLocalModel } from "./clipper-first-run-local-model.component";
import type { ClipperSetupReadiness } from "../hooks/use-clipper-setup-readiness.hook";

const STEP_CIRCLE_SIZE = 28;

function StepCircle({ step, ready }: { step: number; ready: boolean }) {
  const { theme } = useTheme();
  const color = ready ? theme.status.success : theme.status.danger;
  return (
    <Box
      w={`${STEP_CIRCLE_SIZE}px`}
      h={`${STEP_CIRCLE_SIZE}px`}
      borderRadius="full"
      borderWidth="1.5px"
      borderColor={color}
      bg={theme.background.card}
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      position="relative"
      zIndex={1}
    >
      <Text fontSize="sm" fontWeight="semibold" color={color} lineHeight="1">
        {step}
      </Text>
    </Box>
  );
}

function SetupStep({
  step,
  ready,
  title,
  description,
  children,
}: {
  step: number;
  ready: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { theme } = useTheme();
  return (
    <VStack align="stretch" gap={3} w="full">
      <HStack
        align="center"
        gap={3}
        alignSelf="flex-start"
        bg={theme.background.card}
        position="relative"
        zIndex={1}
        pr={3}
      >
        <StepCircle step={step} ready={ready} />
        <Text fontWeight="semibold" color={theme.text.primary}>
          {title}
        </Text>
      </HStack>
      <Text fontSize="sm" color={theme.text.muted} pl={`${STEP_CIRCLE_SIZE + 12}px`}>
        {description}
      </Text>
      <Box pl={`${STEP_CIRCLE_SIZE + 12}px`}>{children}</Box>
    </VStack>
  );
}

interface ClipperFirstRunSetupProps {
  readiness: ClipperSetupReadiness;
}

export function ClipperFirstRunSetup({ readiness }: ClipperFirstRunSetupProps) {
  const { theme } = useTheme();
  const { vocals, parakeet, whisper, vocalsReady, asrReady } = readiness;
  const parakeetInstalled = Boolean(parakeet.modelStatus?.installed);
  const connectorColor = vocalsReady ? theme.status.success : theme.dashboard.border;

  return (
    <Box
      p={{ base: 6, md: 8 }}
      borderRadius="2xl"
      border="1px dashed"
      borderColor={theme.dashboard.border}
      bg={theme.background.card}
      flex="1"
      display="flex"
      flexDirection="column"
      justifyContent="flex-start"
    >
      <VStack align="stretch" gap={8} w="full">
        <VStack align="start" gap={1}>
          <Text color={theme.text.primary} fontWeight="semibold">
            Set up Clipper first
          </Text>
          <Text color={theme.text.muted} fontSize="sm">
            Download the vocals model, then a local speech model or a cloud API key.
          </Text>
        </VStack>

        <Box position="relative" w="full">
          <Box
            display={{ base: "none", md: "block" }}
            position="absolute"
            top={`${STEP_CIRCLE_SIZE / 2}px`}
            left={`${STEP_CIRCLE_SIZE / 2}px`}
            w="calc(50% + 1.25rem)"
            h="1px"
            bg={connectorColor}
            pointerEvents="none"
          />
          <HStack align="start" gap={{ base: 8, md: 10 }} flexWrap="wrap" w="full">
            <Box flex="1" minW={{ base: "full", md: "280px" }}>
              <SetupStep
                step={1}
                ready={vocalsReady}
                title="Vocals isolate"
                description="Separates vocals from the mix before transcription. ~67 MB."
              >
                <ClipperFirstRunLocalModel
                  name="Vocals isolate"
                  buttonLabel="Download"
                  installedLabel="Installed"
                  downloading={vocals.downloading}
                  downloadProgress={vocals.downloadProgress}
                  downloadReceived={vocals.downloadReceived}
                  downloadTotal={vocals.downloadTotal}
                  showDownload={vocals.showDownload}
                  installed={vocalsReady}
                  error={vocals.error}
                  onDownload={() => void vocals.handleDownload()}
                />
              </SetupStep>
            </Box>

            <Box flex="1" minW={{ base: "full", md: "280px" }}>
              <SetupStep
                step={2}
                ready={asrReady}
                title="Speech-to-text"
                description="Download Parakeet (~671 MB) or Whisper (~1.75 GB) locally, or save a Groq or OpenRouter API key."
              >
                <HStack align="start" gap={4} flexWrap="wrap">
                  <Box flex="1" minW="180px">
                    <ClipperFirstRunLocalModel
                      name="Parakeet"
                      downloading={parakeet.downloading}
                      downloadProgress={parakeet.downloadProgress}
                      downloadReceived={parakeet.downloadReceived}
                      downloadTotal={parakeet.downloadTotal}
                      showDownload={parakeet.showDownload}
                      installed={parakeetInstalled}
                      error={parakeet.error}
                      downloadDisabled={whisper.downloading}
                      onDownload={() => void readiness.downloadParakeetAndSelect()}
                    />
                  </Box>
                  <Box flex="1" minW="180px">
                    <ClipperFirstRunLocalModel
                      name="Whisper"
                      downloading={whisper.downloading}
                      downloadProgress={whisper.downloadProgress}
                      downloadReceived={whisper.downloadReceived}
                      downloadTotal={whisper.downloadTotal}
                      showDownload={whisper.showDownload}
                      installed={whisper.installed}
                      error={whisper.error}
                      downloadDisabled={parakeet.downloading}
                      onDownload={() => void readiness.downloadWhisperAndSelect()}
                    />
                  </Box>
                </HStack>
                <VStack align="stretch" gap={3} mt={1}>
                  <HStack gap={3} align="center">
                    <Box flex="1" h="1px" bg={theme.dashboard.border} />
                    <Text fontSize="xs" color={theme.text.muted}>
                      or
                    </Text>
                    <Box flex="1" h="1px" bg={theme.dashboard.border} />
                  </HStack>
                  <ClipperFirstRunApiKey
                    groq={readiness.groq}
                    openrouter={readiness.openrouter}
                    onSave={readiness.saveApiKeyAndSelect}
                  />
                </VStack>
              </SetupStep>
            </Box>
          </HStack>
        </Box>
      </VStack>
    </Box>
  );
}
