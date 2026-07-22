import { Box, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useTheme } from "../../../theme";
import { AppLoader } from "../../../shared/components/app-loader.component";

interface OAuthProcessingLayoutProps {
  title?: string;
  description?: string;
  badgeText?: string;
  footerText?: string;
  footerIcon?: any;
  isFooterIconRotating?: boolean;
  showLogo?: boolean;
  showProgressBar?: boolean;
  children?: ReactNode;
  statusColor?: string;
}

export function OAuthProcessingLayout({
  title,
  description,
  children,
  statusColor,
}: OAuthProcessingLayoutProps) {
  const { theme } = useTheme();

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      height="100vh"
      width="100vw"
      bg={theme.background.primary}
    >
      <VStack gap={4}>
        {children ? (
          children
        ) : (
          <AppLoader centered={false} />
        )}
        {title && (
          <Text
            fontSize="lg"
            fontWeight="600"
            color={statusColor || theme.text.primary}
          >
            {title}
          </Text>
        )}
        {description && (
          <Text
            fontSize="sm"
            color={theme.text.muted}
            textAlign="center"
            maxW="400px"
          >
            {description}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
