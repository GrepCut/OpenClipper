import { Box, Center, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { isTauri } from "../../../shared/utils/platform.util";
import { useTheme } from "../../../theme";
import { ClipperLayout } from "../components/clipper-layout.component";

interface ClipperTauriGateProps {
  children: ReactNode;
}

export function ClipperTauriGate({ children }: ClipperTauriGateProps) {
  const { theme } = useTheme();

  if (isTauri()) {
    return <>{children}</>;
  }

  return (
    <ClipperLayout>
      <Center py={20}>
        <VStack gap={4} maxW="480px" textAlign="center" px={4}>
          <Text color={theme.text.primary} fontSize="xl" fontWeight="semibold">
            Clipper requires the desktop app
          </Text>
          <Text color={theme.text.distinct}>
            GrepCut Clipper is available in the Tauri desktop build only. Open this project in the
            desktop app to continue.
          </Text>
        </VStack>
      </Center>
    </ClipperLayout>
  );
}
