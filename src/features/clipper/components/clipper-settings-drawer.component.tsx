import React from "react";
import { Box, Drawer, IconButton, Portal } from "@chakra-ui/react";
import { X } from "lucide-react";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperSettings } from "../settings/settings.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  ClipperSettingsDrawerTriggers,
  clipperSettingsDrawerPanelTitle,
} from "./clipper-settings-drawer-triggers.component";
import {
  CLIPPER_SETTINGS_DRAWER_CONTENT_ID,
  type ClipperSettingsDrawerPanel,
} from "./clipper-settings-drawer.types";
import { ClipperSettingsPanel } from "./clipper-settings-panel.component";

export type { ClipperSettingsDrawerPanel } from "./clipper-settings-drawer.types";

interface ClipperSettingsDrawerProps {
  activePanel: ClipperSettingsDrawerPanel | null;
  onActivePanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
  settings: ClipperSettings;
  words: WordCue[];
  onUpdateSettings: (
    updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings),
  ) => void;
  /** When false, hides the rail and settings drawer (e.g. off the preview screen). */
  visible?: boolean;
}

export const ClipperSettingsDrawer: React.FC<ClipperSettingsDrawerProps> = ({
  activePanel,
  onActivePanelChange,
  settings,
  words,
  onUpdateSettings,
  visible = true,
}) => {
  const { theme, scrollbarCss } = useClipperUi();
  const open = visible && activePanel !== null;
  const panelTitle = clipperSettingsDrawerPanelTitle(activePanel);

  if (!visible) {
    return null;
  }

  return (
    <>
      <Portal>
        <ClipperSettingsDrawerTriggers
          activePanel={activePanel}
          onPanelChange={onActivePanelChange}
        />
      </Portal>

      <Drawer.Root
        open={open}
        onOpenChange={(details) => {
          if (!details.open) onActivePanelChange(null);
        }}
        placement={{ base: "bottom", lg: "end" }}
        size={{ base: "full", lg: "full" }}
        modal={false}
        preventScroll={false}
        closeOnInteractOutside={false}
        trapFocus={false}
      >
        <Portal>
          <Drawer.Positioner
            paddingLeft={{ base: 0, lg: "42%" }}
            zIndex={1700}
            pointerEvents="none"
          >
            <Drawer.Content
              id={CLIPPER_SETTINGS_DRAWER_CONTENT_ID}
              pointerEvents="auto"
              bg={theme.dashboard.gradientCard}
              border="none"
              boxShadow={{
                base: "0 -16px 48px rgba(0, 0, 0, 0.55)",
                lg: "-24px 0 64px rgba(0, 0, 0, 0.5), -8px 0 24px rgba(0, 0, 0, 0.35)",
              }}
              display="flex"
              flexDirection="column"
              maxH={{ base: "85vh", lg: "100dvh" }}
              borderTopRadius={{ base: "2xl", lg: 0 }}
            >
              <Drawer.Header
                position="relative"
                borderBottom="1px solid"
                borderColor={theme.dashboard.border}
                flexShrink={0}
                pr={12}
              >
                <Drawer.Title color={theme.text.primary} fontSize="lg" fontWeight="semibold">
                  {panelTitle}
                </Drawer.Title>
                <IconButton
                  aria-label={`Close ${panelTitle.toLowerCase()} settings`}
                  position="absolute"
                  top={3}
                  right={3}
                  zIndex={1}
                  size="sm"
                  variant="ghost"
                  borderRadius="lg"
                  color={theme.text.muted}
                  onClick={() => onActivePanelChange(null)}
                  _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
                >
                  <X size={18} />
                </IconButton>
              </Drawer.Header>

              <Drawer.Body
                flex="1"
                overflowY="auto"
                px={4}
                py={4}
                css={{ ...scrollbarCss, direction: "rtl" }}
              >
                <Box css={{ direction: "ltr" }}>
                  {activePanel ? (
                    <ClipperSettingsPanel
                      settings={settings}
                      words={words}
                      hideTranscript
                      activePanel={activePanel}
                      onUpdateSettings={onUpdateSettings}
                    />
                  ) : null}
                </Box>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </>
  );
};
