import React from "react";
import { Box, VStack } from "@chakra-ui/react";
import { Stamp, Type, type LucideIcon } from "lucide-react";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  CLIPPER_SETTINGS_DRAWER_CONTENT_ID,
  CLIPPER_SETTINGS_DRAWER_PANELS,
  type ClipperSettingsDrawerPanel,
} from "./clipper-settings-drawer.types";

const PANEL_META: Record<
  ClipperSettingsDrawerPanel,
  { label: string; Icon: LucideIcon }
> = {
  captions: { label: "Captions", Icon: Type },
  branding: { label: "Branding", Icon: Stamp },
};

interface SettingsToggleButtonProps {
  panel: ClipperSettingsDrawerPanel;
  activePanel: ClipperSettingsDrawerPanel | null;
  onPanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
}

function SettingsToggleButton({
  panel,
  activePanel,
  onPanelChange,
}: SettingsToggleButtonProps) {
  const { theme } = useClipperUi();
  const open = activePanel === panel;
  const { label, Icon } = PANEL_META[panel];

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
      aria-controls={CLIPPER_SETTINGS_DRAWER_CONTENT_ID}
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

interface ClipperSettingsDrawerTriggersProps {
  activePanel: ClipperSettingsDrawerPanel | null;
  onPanelChange: (panel: ClipperSettingsDrawerPanel | null) => void;
}

export function clipperSettingsDrawerPanelTitle(
  panel: ClipperSettingsDrawerPanel | null,
): string {
  return panel ? PANEL_META[panel].label : "Captions";
}

export const ClipperSettingsDrawerTriggers: React.FC<
  ClipperSettingsDrawerTriggersProps
> = ({ activePanel, onPanelChange }) => {
  const renderButtons = () =>
    CLIPPER_SETTINGS_DRAWER_PANELS.map((panel) => (
      <SettingsToggleButton
        key={panel}
        panel={panel}
        activePanel={activePanel}
        onPanelChange={onPanelChange}
      />
    ));

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
        {renderButtons()}
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
        {renderButtons()}
      </VStack>
    </>
  );
};
