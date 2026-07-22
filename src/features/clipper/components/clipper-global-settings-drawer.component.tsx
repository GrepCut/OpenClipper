import React from "react";
import { Box, Drawer, IconButton, Portal, Text, VStack } from "@chakra-ui/react";
import { Settings, X } from "lucide-react";
import type { ClipperSettings } from "../settings/settings.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperSettingsPanel } from "./clipper-settings-panel.component";

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
}

export const ClipperHomeHeaderActions: React.FC<ClipperHomeHeaderActionsProps> = ({
  onOpenSettings,
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
    </Box>
  );
};
