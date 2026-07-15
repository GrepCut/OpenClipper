import React from "react";
import { Box, Drawer, IconButton, Portal, Text, VStack } from "@chakra-ui/react";
import { LogOut, Settings, X } from "lucide-react";
import type { ClipperSettings } from "../settings/settings";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import { ClipperSettingsPanel } from "./ClipperSettingsPanel";

const DRAWER_CONTENT_ID = "clipper-global-settings-drawer";

interface ClipperGlobalSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ClipperSettings;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
}

export const ClipperGlobalSettingsDrawer: React.FC<ClipperGlobalSettingsDrawerProps> = ({
  open,
  onOpenChange,
  settings,
  onUpdateSettings,
}) => {
  const { theme, scrollbarCss } = useClipperUi();

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      placement="end"
      size="md"
    >
      <Portal>
        <Drawer.Backdrop bg="blackAlpha.600" />
        <Drawer.Positioner zIndex={1700}>
          <Drawer.Content
            id={DRAWER_CONTENT_ID}
            bg={theme.dashboard.gradientCard}
            borderLeft="1px solid"
            borderColor={theme.dashboard.border}
            boxShadow="-16px 0 48px rgba(0, 0, 0, 0.45)"
            display="flex"
            flexDirection="column"
            maxH="100dvh"
          >
            <Drawer.Header
              borderBottom="1px solid"
              borderColor={theme.dashboard.border}
              flexShrink={0}
              pr={12}
            >
              <VStack align="start" gap={0.5}>
                <Drawer.Title color={theme.text.primary} fontSize="lg" fontWeight="semibold">
                  Default settings
                </Drawer.Title>
                <Text fontSize="xs" color={theme.text.muted}>
                  Applied to new clip projects
                </Text>
              </VStack>
              <Drawer.CloseTrigger asChild position="absolute" top={3} right={3}>
                <IconButton
                  aria-label="Close settings"
                  size="sm"
                  variant="ghost"
                  borderRadius="lg"
                  color={theme.text.muted}
                  _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
                >
                  <X size={18} />
                </IconButton>
              </Drawer.CloseTrigger>
            </Drawer.Header>

            <Drawer.Body flex="1" overflowY="auto" px={4} py={4} css={scrollbarCss}>
              <ClipperSettingsPanel
                settings={settings}
                words={[]}
                hasDetectedFaces={null}
                hasTwoSpeakers={null}
                hideTranscript
                onUpdateSettings={onUpdateSettings}
              />
            </Drawer.Body>
          </Drawer.Content>
        </Drawer.Positioner>
      </Portal>
    </Drawer.Root>
  );
};

interface ClipperHomeHeaderActionsProps {
  onOpenSettings: () => void;
  onLogout: () => void;
  isLoggingOut?: boolean;
  userEmail?: string | null;
}

export const ClipperHomeHeaderActions: React.FC<ClipperHomeHeaderActionsProps> = ({
  onOpenSettings,
  onLogout,
  isLoggingOut = false,
  userEmail,
}) => {
  const { theme } = useClipperUi();

  return (
    <Box display="flex" alignItems="center" gap={1} mr={1}>
      <IconButton
        aria-label="Settings"
        title="Settings"
        size="sm"
        variant="ghost"
        borderRadius="lg"
        color={theme.text.muted}
        onClick={onOpenSettings}
        _hover={{ bg: theme.surface.hover, color: clipperTheme.accentLight }}
      >
        <Settings size={18} />
      </IconButton>
      <Box
        as="button"
        type="button"
        display="flex"
        alignItems="center"
        gap={2}
        px={2.5}
        py={1.5}
        borderRadius="lg"
        fontSize="sm"
        color={theme.text.muted}
        cursor={isLoggingOut ? "wait" : "pointer"}
        opacity={isLoggingOut ? 0.6 : 1}
        onClick={() => {
          if (!isLoggingOut) onLogout();
        }}
        _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
        title={userEmail ? `Sign out (${userEmail})` : "Sign out"}
      >
        <LogOut size={16} />
        <Text display={{ base: "none", md: "block" }} maxW="180px" truncate>
          {isLoggingOut ? "Signing out…" : "Sign out"}
        </Text>
      </Box>
    </Box>
  );
};
