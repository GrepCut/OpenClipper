import React from "react";
import { Box, Drawer, IconButton, Portal, Text, VStack } from "@chakra-ui/react";
import { ChevronLeft, SlidersHorizontal, X } from "lucide-react";
import type { WordCue } from "../lib/media/transcription-export";
import type { ClipperSettings } from "../settings/settings";
import { clipperTheme } from "../shared/theme";
import { useClipperUi } from "../shared/use-clipper-ui";
import { ClipperSettingsPanel } from "./ClipperSettingsPanel";

const DRAWER_CONTENT_ID = "clipper-settings-drawer";
const DESKTOP_TAB_WIDTH = "120px";

interface SettingsRailTabProps {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
}

function SettingsRailTab({ open, onToggle, controlsId }: SettingsRailTabProps) {
  const { theme } = useClipperUi();

  return (
    <Box
      as="button"
      type="button"
      position="fixed"
      right={0}
      top="50%"
      transform="translateY(-50%)"
      zIndex={1800}
      display={{ base: "none", lg: "flex" }}
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      gap={2}
      w={DESKTOP_TAB_WIDTH}
      py={4}
      pl={4}
      pr={5}
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
      aria-label={open ? "Close settings" : "Open settings"}
      onClick={onToggle}
      transition="color 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease"
      _hover={{
        transform: "translateY(-50%) translateX(-2px)",
        color: clipperTheme.accentLight,
        bg: `rgba(${clipperTheme.accentTintRgb}, 0.12)`,
        borderColor: `rgba(${clipperTheme.accentTintRgb}, 0.55)`,
        boxShadow: `-6px 0 20px rgba(0, 0, 0, 0.35), 0 0 12px rgba(${clipperTheme.accentTintRgb}, 0.25)`,
      }}
      _active={{
        transform: "translateY(-50%)",
      }}
    >
      <ChevronLeft
        size={27}
        strokeWidth={2}
        style={{
          flexShrink: 0,
          transform: open ? "rotate(180deg)" : undefined,
          transition: "transform 0.2s ease",
        }}
      />
      <Text fontSize="14px" fontWeight="semibold" color="inherit" lineHeight="1">
        Settings
      </Text>
    </Box>
  );
}

function SettingsMobileTab({ open, onToggle, controlsId }: SettingsRailTabProps) {
  const { theme } = useClipperUi();

  return (
    <Box
      as="button"
      type="button"
      position="fixed"
      right={4}
      bottom={6}
      zIndex={1800}
      display={{ base: "flex", lg: "none" }}
      alignItems="center"
      gap={2.5}
      pl={3}
      pr={4}
      py={2.5}
      borderRadius="full"
      border="1px solid"
      borderColor={theme.dashboard.border}
      bg={theme.dashboard.glass}
      backdropFilter="blur(16px)"
      color={theme.text.primary}
      boxShadow={theme.shadow.panel}
      cursor="pointer"
      aria-expanded={open}
      aria-controls={controlsId}
      aria-label={open ? "Close settings" : "Open settings"}
      onClick={onToggle}
    >
      <Box
        w="32px"
        h="32px"
        borderRadius="full"
        display="flex"
        alignItems="center"
        justifyContent="center"
        bg={`rgba(${clipperTheme.accentTintRgb}, 0.16)`}
        color={clipperTheme.accentLight}
      >
        <SlidersHorizontal size={15} strokeWidth={1.75} />
      </Box>
      <Text fontSize="sm" fontWeight="medium">
        Settings
      </Text>
    </Box>
  );
}

interface ClipperSettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: ClipperSettings;
  words: WordCue[];
  hasDetectedFaces: boolean | null;
  hasTwoSpeakers: boolean | null;
  onUpdateSettings: (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => void;
}

export const ClipperSettingsDrawer: React.FC<ClipperSettingsDrawerProps> = ({
  open,
  onOpenChange,
  settings,
  words,
  hasDetectedFaces,
  hasTwoSpeakers,
  onUpdateSettings,
}) => {
  const { theme, scrollbarCss } = useClipperUi();

  return (
    <>
      <Portal>
        <SettingsRailTab
          open={open}
          onToggle={() => onOpenChange(!open)}
          controlsId={DRAWER_CONTENT_ID}
        />
      </Portal>

      <Drawer.Root
        open={open}
        onOpenChange={(details) => onOpenChange(details.open)}
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
                borderBottom="1px solid"
                borderColor={theme.dashboard.border}
                flexShrink={0}
                pr={12}
              >
                <VStack align="start" gap={0.5}>
                  <Drawer.Title color={theme.text.primary} fontSize="lg" fontWeight="semibold">
                    Settings
                  </Drawer.Title>
                  <Text fontSize="xs" color={theme.text.muted}>
                    Applies to all clips
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

              <Drawer.Body
                flex="1"
                overflowY="auto"
                px={4}
                py={4}
                css={{ ...scrollbarCss, direction: "rtl" }}
              >
                <Box css={{ direction: "ltr" }}>
                  <ClipperSettingsPanel
                    settings={settings}
                    words={words}
                    hasDetectedFaces={hasDetectedFaces}
                    hasTwoSpeakers={hasTwoSpeakers}
                    onUpdateSettings={onUpdateSettings}
                  />
                </Box>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>

      <Portal>
        <SettingsMobileTab
          open={open}
          onToggle={() => onOpenChange(!open)}
          controlsId={DRAWER_CONTENT_ID}
        />
      </Portal>
    </>
  );
};
