import { Box, Text, VStack } from "@chakra-ui/react";
import { AppLoader } from "./app-loader.component";
import { useTheme } from '../../theme';

interface ProjectLoadingScreenProps {
  type: "loading" | "error";
  message?: string;
  errorDetails?: string;
}

export const ProjectLoadingScreen = ({
  type,
  message,
  errorDetails,
}: ProjectLoadingScreenProps) => {
  const { theme } = useTheme();

  if (type === "error") {
    return (
      <Box
        minH="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg={theme.background.primary}
      >
        <VStack gap={4}>
          <Text color={theme.status.error} fontSize="lg" fontWeight="medium">
            Error: {message}
          </Text>
          {errorDetails && (
            <Text color={theme.text.secondary}>{errorDetails}</Text>
          )}
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      minH="100%"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg={theme.background.primary}
    >
      <VStack gap={4}>
        <AppLoader centered={false} />
      </VStack>
    </Box>
  );
};
