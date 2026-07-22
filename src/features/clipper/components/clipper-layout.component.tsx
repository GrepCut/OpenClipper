import React from "react";
import { Box, HStack, Image, Text } from "@chakra-ui/react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { WindowControls } from "../../../shared/components/window-controls.component";
import { useTauriTitleBarHandlers } from "../../../shared/hooks/use-tauri-title-bar-handlers.hook";
import { asset } from "../../../shared/utils/asset.util";
import { isTauri } from "../../../shared/utils/platform.util";
import { colors, useTheme } from "../../../theme";
import { clipperTheme } from "../shared/theme.util";
import { AccountHeaderAction } from "../../authentication/account-header-action.component";

export interface ClipperLayoutStep {
  current?: number;
  total?: number;
  title: string;
}

export interface ClipperLayoutBackLink {
  label: string;
  onClick: () => void;
}

interface ClipperLayoutProps {
  children: React.ReactNode;
  /** Contextual step indicator — shown centered in the header bar. */
  step?: ClipperLayoutStep;
  /** Overrides the default router back link (e.g. in-session sub-views). */
  backLink?: ClipperLayoutBackLink;
  /** Extra content rendered after the logo (e.g. home nav toggle). */
  headerStartExtra?: React.ReactNode;
  /** Extra controls rendered before window controls (e.g. settings, logout). */
  headerActions?: React.ReactNode;
}

export const ClipperLayout: React.FC<ClipperLayoutProps> = ({
  children,
  step,
  backLink,
  headerStartExtra,
  headerActions,
}) => {
  const { theme } = useTheme();
  const location = useLocation();
  const isSessionPage = /^\/clipper\/[^/]+/.test(location.pathname);
  const backTo = "/clipper";
  const backLabel = isSessionPage ? "Back to clipper projects" : "Back to clipper";
  const titleBarHandlers = useTauriTitleBarHandlers({ excludeSelectors: ["a", "button"] });

  const scrollbarCss = {
    scrollbarWidth: "thin" as const,
    scrollbarColor: `${theme.scrollbar.thumb} ${theme.scrollbar.track}`,
    "&::-webkit-scrollbar": { width: "8px", height: "8px" },
    "&::-webkit-scrollbar-track": { background: theme.scrollbar.track },
    "&::-webkit-scrollbar-thumb": {
      background: theme.scrollbar.thumb,
      borderRadius: "4px",
    },
    "&::-webkit-scrollbar-thumb:hover": {
      background: colors.purple.medium,
    },
  };

  const backLinkElement = backLink ? (
    <HStack
      as="button"
      gap={2}
      color={theme.text.muted}
      fontSize="sm"
      flexShrink={0}
      onClick={backLink.onClick}
      _hover={{ color: theme.brand.purpleLight }}
    >
      <ArrowLeft size={16} />
      <Text whiteSpace="nowrap">{backLink.label}</Text>
    </HStack>
  ) : (
    <HStack
      as={RouterLink}
      to={backTo}
      gap={2}
      color={theme.text.muted}
      fontSize="sm"
      flexShrink={0}
      _hover={{ color: theme.brand.purpleLight, textDecoration: "none" }}
    >
      <ArrowLeft size={16} />
      <Text whiteSpace="nowrap">{backLabel}</Text>
    </HStack>
  );

  return (
    <Box
      h="100%"
      display="flex"
      flexDirection="column"
      overflow="hidden"
      bg={theme.dashboard.gradientMain}
      color={theme.text.primary}
    >
      <Box
        borderBottom="1px solid"
        borderColor={theme.dashboard.border}
        bg={theme.dashboard.glass}
        backdropFilter="blur(12px)"
        flexShrink={0}
        {...titleBarHandlers}
      >
        <Box w="full" py={isTauri() ? 0 : 4} px={4}>
          <HStack
            justify="space-between"
            position="relative"
            h={isTauri() ? "50px" : "auto"}
            minH={isTauri() ? undefined : "44px"}
          >
            <HStack gap={4} flexShrink={0}>
              <Image src={asset("/clipper/clipper-logo.png")} alt="Open Clipper" h="28px" objectFit="contain" />
              {headerStartExtra}
              {(backLink || isSessionPage) && backLinkElement}
            </HStack>

            {step ? (
              <HStack
                position="absolute"
                left="50%"
                transform="translateX(-50%)"
                gap={2.5}
                fontSize="sm"
                pointerEvents="none"
                maxW="calc(100% - 280px)"
              >
                {step.current != null && step.total != null ? (
                  <Box
                    px={2.5}
                    py={0.5}
                    borderRadius="full"
                    fontSize="xs"
                    fontWeight="semibold"
                    letterSpacing="0.02em"
                    color={clipperTheme.accent}
                    bg={theme.brand.purpleSoftAlpha12}
                    whiteSpace="nowrap"
                    flexShrink={0}
                  >
                    Step {step.current} of {step.total}
                  </Box>
                ) : null}
                <Text
                  color={theme.text.muted}
                  fontWeight="medium"
                  whiteSpace="nowrap"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  display={{ base: "none", sm: "block" }}
                >
                  {step.title}
                </Text>
              </HStack>
            ) : null}

            {isTauri() ? (
              <HStack gap={1} flexShrink={0}>
                {headerActions}
                <AccountHeaderAction />
                <WindowControls
                  textColor={theme.text.muted}
                  btnHoverBg={theme.surface.hover}
                />
              </HStack>
            ) : (
              <HStack gap={1} flexShrink={0}>
                {headerActions}
                <AccountHeaderAction />
              </HStack>
            )}
          </HStack>
        </Box>
      </Box>

      <Box flex="1" overflowY="auto" css={scrollbarCss}>
        <Box w="full" py={{ base: 6, md: 8 }} px={4}>
          {children}
        </Box>
      </Box>
    </Box>
  );
};
