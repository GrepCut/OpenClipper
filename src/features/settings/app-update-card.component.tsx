import { useMemo } from "react";
import { Box, HStack, Stack, Text, VStack } from "@chakra-ui/react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  MonitorUp,
} from "lucide-react";
import { useAppUpdateStore } from "../../stores/use-app-update.store";
import { useTheme } from "../../theme";
import { isTauri } from "../../shared/utils/platform.util";
import { SecondaryMainTitle } from "../../shared/fonts/secondary-main-title.font";
import { SpecificTitle } from "../../shared/fonts/specific-title.font";
import { MainButton } from "../../shared/components/buttons/main-button.component";
import { OutlinedActionButton } from "../../shared/components/buttons/outlined-action-button.component";

const formatDate = (value: string | null | undefined): string => {
  if (!value) return "Unknown";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

export function AppUpdateCard() {
  const { theme, mode } = useTheme();
  const {
    appName,
    currentVersion,
    availableUpdate,
    status,
    error,
    lastCheckedAt,
    downloadedBytes,
    contentLength,
    checkForUpdates,
    installUpdate,
  } = useAppUpdateStore();

  const progressRatio = useMemo(() => {
    if (!contentLength || contentLength <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(1, downloadedBytes / contentLength));
  }, [contentLength, downloadedBytes]);

  if (!isTauri()) {
    return null;
  }

  const statusTone =
    status === "error"
      ? "red.400"
      : status === "available"
        ? theme.interactive.selectedClipStart
        : status === "disabled"
          ? "orange.400"
          : "green.400";

  const statusIcon =
    status === "error"
      ? AlertTriangle
      : status === "available"
        ? MonitorUp
        : status === "disabled"
          ? AlertTriangle
          : CheckCircle2;

  const statusLabel = (() => {
    switch (status) {
      case "checking":
        return "Checking for updates";
      case "available":
        return `Version ${availableUpdate?.version ?? "unknown"} is available`;
      case "downloading":
        return "Downloading update";
      case "installing":
        return "Installing update";
      case "disabled":
        return "Updater is not configured";
      case "error":
        return "Update check failed";
      case "upToDate":
        return "Application is up to date";
      default:
        return "Ready to check for updates";
    }
  })();

  return (
    <Box
      bg={mode === "dark" ? "whiteAlpha.50" : "white"}
      p={4}
      borderRadius="2xl"
      border="1px solid"
      borderColor={mode === "dark" ? "whiteAlpha.100" : "gray.100"}
      boxShadow={
        mode === "dark"
          ? "0 4px 24px rgba(0,0,0,0.2)"
          : "0 4px 24px rgba(0,0,0,0.04)"
      }
    >
      <VStack align="stretch" gap={4}>
        <Stack
          direction={{ base: "column", md: "row" }}
          justify="space-between"
          align={{ base: "stretch", md: "center" }}
          gap={4}
        >
          <Box>
            <SecondaryMainTitle>Application updates</SecondaryMainTitle>
            <Text fontSize="sm" color={theme.text.muted}>
              Check desktop releases and install the latest signed build.
            </Text>
          </Box>
          <HStack gap={3}>
            <OutlinedActionButton
              size="sm"
              h="36px"
              fontSize="sm"
              px={4}
              onClick={() => void checkForUpdates(true)}
              disabled={
                status === "checking" ||
                status === "downloading" ||
                status === "installing"
              }
              startIcon={<RefreshCw size={16} />}
            >
              Check now
            </OutlinedActionButton>
            <MainButton
              size="sm"
              h="36px"
              fontSize="sm"
              px={4}
              onClick={() => void installUpdate()}
              disabled={
                status === "checking" ||
                status === "downloading" ||
                status === "installing" ||
                !availableUpdate
              }
            >
              <HStack gap={2}>
                <Download size={16} />
                <Text>Update</Text>
              </HStack>
            </MainButton>
          </HStack>
        </Stack>

        <Box
          p={3}
          borderRadius="2xl"
          bg={mode === "dark" ? "whiteAlpha.50" : "gray.50"}
          borderWidth="1px"
          borderColor={mode === "dark" ? "whiteAlpha.100" : "gray.200"}
        >
          <HStack gap={3} align="start">
            <Box as={statusIcon} color={statusTone} boxSize={5} mt="2px" flexShrink={0} />
            <VStack align="start" gap={1} flex={1}>
              <SpecificTitle>{statusLabel}</SpecificTitle>
              <Text fontSize="sm" color={theme.text.muted}>
                {error
                  ? error
                  : status === "available"
                    ? "The update is downloaded after you confirm installation."
                    : status === "disabled"
                      ? "Build Open Clipper with OPEN_CLIPPER_UPDATER_PUBKEY to enable production updates."
                      : "Automatic background checks happen on desktop app startup."}
              </Text>
            </VStack>
          </HStack>
        </Box>

        <Stack direction={{ base: "column", md: "row" }} gap={4}>
          <Box
            flex={1}
            p={3}
            borderRadius="2xl"
            bg={mode === "dark" ? "rgba(255,255,255,0.03)" : "gray.50"}
          >
            <Text fontSize="xs" color={theme.text.muted} textTransform="uppercase" mb={1}>
              App
            </Text>
            <SpecificTitle>{appName ?? "Open Clipper"}</SpecificTitle>
            <Text fontSize="sm" color={theme.text.secondary}>
              Current version {currentVersion ?? "unknown"}
            </Text>
          </Box>

          <Box
            flex={1}
            p={3}
            borderRadius="2xl"
            bg={mode === "dark" ? "rgba(255,255,255,0.03)" : "gray.50"}
          >
            <Text fontSize="xs" color={theme.text.muted} textTransform="uppercase" mb={1}>
              Latest check
            </Text>
            <SpecificTitle>
              {availableUpdate?.version ??
                (status === "upToDate"
                  ? (currentVersion ?? "No updates")
                  : "No release found")}
            </SpecificTitle>
            <Text fontSize="sm" color={theme.text.secondary}>
              {lastCheckedAt
                ? `Checked ${formatDate(lastCheckedAt)}`
                : "Not checked yet"}
            </Text>
          </Box>
        </Stack>

        {(status === "downloading" || status === "installing") && (
          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" color={theme.text.muted}>
                {status === "installing" ? "Installing..." : "Downloading..."}
              </Text>
              {status === "downloading" && contentLength ? (
                <Text fontSize="sm" color={theme.text.muted}>
                  {formatBytes(downloadedBytes)} / {formatBytes(contentLength)}
                </Text>
              ) : null}
            </HStack>
            <Box
              h="6px"
              borderRadius="full"
              bg={mode === "dark" ? "whiteAlpha.100" : "gray.200"}
              overflow="hidden"
            >
              <Box
                h="100%"
                w={`${Math.max(status === "installing" ? 100 : progressRatio * 100, status === "installing" ? 100 : 4)}%`}
                borderRadius="full"
                bg={theme.interactive.selectedClipStart}
                transition="width 0.2s ease"
              />
            </Box>
          </Box>
        )}

        {availableUpdate?.body ? (
          <Box
            p={3}
            borderRadius="2xl"
            bg={mode === "dark" ? "rgba(255,255,255,0.03)" : "gray.50"}
          >
            <Text fontSize="xs" color={theme.text.muted} textTransform="uppercase" mb={2}>
              Release notes
            </Text>
            <Text fontSize="sm" color={theme.text.secondary} whiteSpace="pre-wrap">
              {availableUpdate.body}
            </Text>
            {availableUpdate.date ? (
              <Text fontSize="xs" color={theme.text.muted} mt={2}>
                Published {formatDate(availableUpdate.date)}
              </Text>
            ) : null}
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
}
