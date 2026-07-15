import { Box, Spinner, Text, VStack } from "@chakra-ui/react";
import { useTheme } from "../../theme";

interface AppLoaderProps {
  message?: string;
  fullScreen?: boolean;
  centered?: boolean;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  borderWidth?: string;
}

/**
 * Standardized loader component for the entire application.
 * Follows the minimal design: Spinner only, unless an error/message is explicitly needed.
 */
export const AppLoader = ({ 
  message, 
  fullScreen = false, 
  centered = true,
  size = "md",
  borderWidth = "3px"
}: AppLoaderProps) => {
  const { theme } = useTheme();

  const content = (
    <VStack gap={4} align="center" justify="center">
      <Spinner 
        size={size} 
        borderWidth={borderWidth} 
        color={theme.brand.purpleLight} 
      />
      {message && (
        <Text fontSize="sm" color={theme.text.secondary} fontWeight="600">
          {message}
        </Text>
      )}
    </VStack>
  );

  if (fullScreen) {
    return (
      <Box
        minH="100vh"
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg={theme.background.primary}
      >
        {content}
      </Box>
    );
  }

  if (centered) {
    return (
      <Box
        h="100%"
        w="100%"
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        {content}
      </Box>
    );
  }

  return content;
};
