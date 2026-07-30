import React from "react";
import { Box, Drawer, IconButton, Portal, Text, VStack } from "@chakra-ui/react";
import { Type, X } from "lucide-react";
import type { WordCue } from "../lib/media/transcription-export.util";
import type { ClipperSettings } from "../settings/settings.util";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { ClipperSettingsPanel } from "./clipper-settings-panel.component";

const DRAWER_CONTENT_ID = "clipper-settings-drawer";
export type ClipperSettingsDrawerPanel = "captions";

interface SettingsToggleButtonProps {
  panel: ClipperSettingsDrawerPanel;
  activePanel: ClipperSettingsDrawerPanel | null;
  onPanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
  controlsId: string;
}

function SettingsToggleButton({
  panel,
  activePanel,
  onPanelChange,
  controlsId,
}: SettingsToggleButtonProps) {
  const { theme } = useClipperUi();
  const open = activePanel === panel;
  const label = "Captions";
  const Icon = Type;

  return (
    <Box
      as="button"
      w="52px"
      h="52px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      bg={theme.dashboard.glass}
      backdropFilter="blur(16px)"
      color={open ? clipperTheme.accentLight : theme.text.muted}
      border="1px solid"
      borderColor={open ? `rgba(${clipperTheme.accentTintRgb}, 0.45)` : theme.dashboard.border}
      borderRight="none"
      borderTopLeftRadius="2xl"
      borderBottomLeftRadius="2xl"
      boxShadow="-4px 0 16px rgba(0, 0, 0, 0.25)"
      cursor="pointer"
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={open ? `Close ${label.toLowerCase()} settings` : `Open ${label.toLowerCase()} settings`}
      title={label}
      onClick={() => onPanelChange(open ? null : panel)}
      transition="color 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease"
      _hover={{
        transform: "translateX(-2px)",
        color: clipperTheme.accentLight,
        bg: `rgba(${clipperTheme.accentTintRgb}, 0.12)`,
        borderColor: `rgba(${clipperTheme.accentTintRgb}, 0.55)`,
        boxShadow: `-6px 0 20px rgba(0, 0, 0, 0.35), 0 0 12px rgba(${clipperTheme.accentTintRgb}, 0.25)`,
      }}
      _active={{
        transform: "translateX(0)",
      }}
    >
      <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
    </Box>
  );
}

interface SettingsDrawerTriggersProps {
  activePanel: ClipperSettingsDrawerPanel | null;
  onPanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
}

function SettingsDrawerTriggers({ activePanel, onPanelChange }: SettingsDrawerTriggersProps) {
  return (
    <>
      <VStack
        position="fixed"
        right={0}
        top="50%"
        transform="translateY(-50%)"
        zIndex={1800}
        display={{ base: "none", lg: "flex" }}
        gap={3}
        align="end"
      >
        <SettingsToggleButton
          panel="captions"
          activePanel={activePanel}
          onPanelChange={onPanelChange}
          controlsId={DRAWER_CONTENT_ID}
        />
      </VStack>

      <VStack
        position="fixed"
        right={4}
        bottom={6}
        zIndex={1800}
        display={{ base: "flex", lg: "none" }}
        gap={3}
        align="end"
      >
        <SettingsToggleButton
          panel="captions"
          activePanel={activePanel}
          onPanelChange={onPanelChange}
          controlsId={DRAWER_CONTENT_ID}
        />
      </VStack>
    </>
  );
}

interface ClipperSettingsDrawerProps {
  activePanel: ClipperSettingsDrawerPanel | null;
  onActivePanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
  settings: ClipperSettings;
  words: WordCue[];
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
}

export const ClipperSettingsDrawer: React.FC<ClipperSettingsDrawerProps> = ({
  activePanel,
  onActivePanelChange,
  settings,
  words,
  onUpdateSettings,
}) => {
  const { theme, scrollbarCss } = useClipperUi();
  const open = activePanel !== null;
  const panelTitle = "Captions";

  return (
    <>
      <Portal>
        <SettingsDrawerTriggers
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
              id={DRAWER_CONTENT_ID}
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
