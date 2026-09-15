import React, { useCallback, useRef } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { ImagePlus, Trash2 } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { OutlinedActionButton } from "../../../../shared/components/buttons/outlined-action-button.component";
import { ThemedInput } from "../../../../shared/components/ui/themed-input.component";
import { openExternalUrl } from "../../../../shared/utils/open-external-url.util";
import { isTauri } from "../../../../shared/utils/platform.util";
import { useClipperBrandingLogo } from "../../hooks/use-clipper-branding-logo.hook";
import {
  BRANDING_LOGO_WIDTH_MAX,
  BRANDING_LOGO_WIDTH_MIN,
  CLIPPER_BRANDING_KINDS,
  type ClipperBrandingKind,
  type ClipperBrandingSettings,
} from "../../settings/branding-settings.util";
import { clipperTheme } from "../../shared/theme.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SettingSlider } from "./setting-controls.component";

interface BrandingSectionProps {
  branding: ClipperBrandingSettings;
  onChange: (patch: Partial<ClipperBrandingSettings>) => void;
}

const KIND_LABEL: Record<ClipperBrandingKind, string> = {
  logo: "Logo",
  text: "Text",
  off: "Off",
};

const CHATGPT_URL = "https://chatgpt.com";
const BACKGROUND_REMOVER_URL = "https://www.remove.bg";
const LOGO_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
const LOGO_FILE_ACCEPT = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";

function brandingFileName(path: string | null): string {
  if (!path) return "No logo selected";
  return path.split(/[\\/]/).pop() || path;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  const { theme } = useClipperUi();
  return (
    <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary} letterSpacing="0.01em">
      {children}
    </Text>
  );
}

function HintLink({ href, children }: { href: string; children: string }) {
  const { theme } = useClipperUi();
  return (
    <Text
      asChild
      display="inline"
      fontSize="xs"
      color={theme.text.muted}
      cursor="pointer"
      textDecoration="underline"
      textUnderlineOffset="2px"
    >
      <button type="button" onClick={() => void openExternalUrl(href)}>
        {children}
      </button>
    </Text>
  );
}

function PercentSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (ratio: number) => void;
  min?: number;
  max?: number;
}) {
  const percent = Math.round(value * 100);
  return (
    <SettingSlider
      label={label}
      min={Math.round(min * 100)}
      max={Math.round(max * 100)}
      value={percent}
      valueLabel={`${percent}%`}
      onChange={(next) => onChange(next / 100)}
    />
  );
}

function revokeBlobUrl(path: string | null): void {
  if (path?.startsWith("blob:")) URL.revokeObjectURL(path);
}

function KindToggle({
  kind,
  onChange,
}: {
  kind: ClipperBrandingKind;
  onChange: (kind: ClipperBrandingKind) => void;
}) {
  const { theme } = useClipperUi();

  return (
    <HStack gap={2} role="group" aria-label="Branding type">
      {CLIPPER_BRANDING_KINDS.map((option) => {
        const active = kind === option;
        return (
          <Box
            key={option}
            as="button"
            aria-pressed={active}
            flex="1"
            py={2}
            borderRadius="2xl"
            border="1px solid"
            borderColor={active ? clipperTheme.settingSelectedBorder : theme.border.primary}
            bg={active ? theme.brand.toggleActiveBg : theme.background.tertiary}
            color={active ? clipperTheme.accentLight : theme.text.onBrandMuted}
            fontSize="sm"
            fontWeight={active ? "semibold" : "medium"}
            cursor="pointer"
            onClick={() => onChange(option)}
          >
            {KIND_LABEL[option]}
          </Box>
        );
      })}
    </HStack>
  );
}

export const BrandingSection: React.FC<BrandingSectionProps> = ({
  branding,
  onChange,
}) => {
  const { theme } = useClipperUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const { kind } = branding;
  const { missing } = useClipperBrandingLogo(kind === "logo" ? branding.imagePath : null);

  const pickLogo = useCallback(async () => {
    if (isTauri()) {
      const path = await open({
        multiple: false,
        filters: [{ name: "Image", extensions: [...LOGO_FILE_EXTENSIONS] }],
      });
      if (!path || Array.isArray(path)) return;
      onChange({ imagePath: path, kind: "logo" });
      return;
    }
    inputRef.current?.click();
  }, [onChange]);

  const onWebFile = useCallback(
    (list: FileList | null) => {
      const file = list?.[0];
      if (inputRef.current) inputRef.current.value = "";
      if (!file) return;
      revokeBlobUrl(branding.imagePath);
      onChange({ imagePath: URL.createObjectURL(file), kind: "logo" });
    },
    [branding.imagePath, onChange],
  );

  return (
    <VStack align="stretch" gap={5}>
      <VStack align="stretch" gap={2}>
        <SectionLabel>Type</SectionLabel>
        <KindToggle kind={kind} onChange={(next) => onChange({ kind: next })} />
      </VStack>

      {kind === "off" ? (
        <Text fontSize="sm" color={theme.text.muted} lineHeight="1.5">
          Branding is turned off. Exported clips will not include a logo or text overlay.
        </Text>
      ) : kind === "logo" ? (
        <VStack align="stretch" gap={2}>
          <SectionLabel>Logo</SectionLabel>
          <HStack gap={2} align="stretch">
            <OutlinedActionButton startIcon={<ImagePlus size={16} />} onClick={() => void pickLogo()}>
              Choose image
            </OutlinedActionButton>
            {branding.imagePath ? (
              <OutlinedActionButton
                tone="danger"
                startIcon={<Trash2 size={16} />}
                onClick={() => {
                  revokeBlobUrl(branding.imagePath);
                  onChange({ imagePath: null });
                }}
              >
                Remove
              </OutlinedActionButton>
            ) : null}
          </HStack>
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_FILE_ACCEPT}
            hidden
            onChange={(event) => onWebFile(event.target.files)}
          />
          <Text fontSize="xs" color={missing ? theme.status.danger : theme.text.muted} lineClamp={2}>
            {missing ? "Logo missing: pick the image again." : brandingFileName(branding.imagePath)}
          </Text>
          <Text fontSize="xs" color={theme.text.muted} lineHeight="1.5">
            PNG, JPG, or WebP. PNG and WebP keep transparency. Ask{" "}
            <HintLink href={CHATGPT_URL}>ChatGPT</HintLink> to make a transparent PNG, or use an{" "}
            <HintLink href={BACKGROUND_REMOVER_URL}>online background remover</HintLink>.
          </Text>
        </VStack>
      ) : (
        <VStack align="stretch" gap={2}>
          <SectionLabel>Text</SectionLabel>
          <ThemedInput
            value={branding.text}
            placeholder="White overlay text"
            borderRadius="md"
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </VStack>
      )}

      {kind !== "off" ? (
        <>
          <PercentSlider
            label="Horizontal"
            value={branding.offsetX}
            onChange={(offsetX) => onChange({ offsetX })}
          />
          <PercentSlider
            label="Vertical"
            value={branding.offsetY}
            onChange={(offsetY) => onChange({ offsetY })}
          />
          <PercentSlider
            label="Size"
            min={BRANDING_LOGO_WIDTH_MIN}
            max={BRANDING_LOGO_WIDTH_MAX}
            value={branding.logoWidthRatio}
            onChange={(logoWidthRatio) => onChange({ logoWidthRatio })}
          />
          <PercentSlider
            label="Opacity"
            value={branding.opacity}
            onChange={(opacity) => onChange({ opacity })}
          />
        </>
      ) : null}
    </VStack>
  );
};
