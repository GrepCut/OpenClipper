import React, { useRef } from "react";
import { Button, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { Upload, X } from "lucide-react";
import { ModernSwitch } from "../../../../shared/components/ui/modern-switch.component";
import type { ClipperBrandingSettings, ClipperWatermarkCorner } from "../../settings/settings.util";
import { clampOverlaySeconds, clampWatermarkScale } from "../../settings/settings.util";
import { clipperTheme } from "../../shared/theme.util";
import { useClipperUi } from "../../shared/use-clipper-ui.hook";
import { SegmentedControl, SettingRow, SettingSection, SettingSlider } from "./setting-controls.component";

interface BrandingSectionProps {
  branding: ClipperBrandingSettings;
  onChange: (patch: Partial<ClipperBrandingSettings>) => void;
}

const CORNER_OPTIONS: { value: ClipperWatermarkCorner; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const BrandingSection: React.FC<BrandingSectionProps> = ({ branding, onChange }) => {
  const { theme } = useClipperUi();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleWatermarkFile = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    onChange({ watermarkDataUrl: dataUrl });
  };

  return (
    <SettingSection title="Branding & overlays" description="Watermark, intro/outro text, progress bar">
      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Watermark
        </Text>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => void handleWatermarkFile(e.target.files?.[0])}
        />
        {branding.watermarkDataUrl ? (
          <HStack gap={3}>
            <img
              src={branding.watermarkDataUrl}
              alt="Watermark"
              style={{ width: 40, height: 40, objectFit: "contain", borderRadius: 8, background: theme.surface.faint }}
            />
            <Button
              size="sm"
              variant="outline"
              borderRadius="lg"
              borderColor={theme.surface.elevated}
              color={theme.brand.purpleText}
              onClick={() => onChange({ watermarkDataUrl: null })}
            >
              <HStack gap={2}>
                <X size={14} />
                <span>Remove</span>
              </HStack>
            </Button>
          </HStack>
        ) : (
          <Button
            size="sm"
            variant="outline"
            borderRadius="lg"
            borderColor={theme.surface.elevated}
            color={theme.brand.purpleText}
            onClick={() => fileInputRef.current?.click()}
            _hover={{ bg: `rgba(${clipperTheme.accentTintRgb},0.14)` }}
          >
            <HStack gap={2}>
              <Upload size={14} />
              <span>Upload logo</span>
            </HStack>
          </Button>
        )}
      </VStack>

      {branding.watermarkDataUrl && (
        <>
          <VStack align="stretch" gap={2}>
            <Text fontSize="sm" color={theme.text.onBrandMuted}>
              Position
            </Text>
            <SegmentedControl
              options={CORNER_OPTIONS}
              value={branding.watermarkCorner}
              onChange={(v) => onChange({ watermarkCorner: v })}
            />
          </VStack>
          <SettingSlider
            label="Size"
            value={Math.round(branding.watermarkScale * 100)}
            min={5}
            max={40}
            valueLabel={`${Math.round(branding.watermarkScale * 100)}%`}
            onChange={(v) => onChange({ watermarkScale: clampWatermarkScale(v / 100) })}
          />
          <SettingSlider
            label="Opacity"
            value={Math.round(branding.watermarkOpacity * 100)}
            min={10}
            max={100}
            valueLabel={`${Math.round(branding.watermarkOpacity * 100)}%`}
            onChange={(v) => onChange({ watermarkOpacity: v / 100 })}
          />
        </>
      )}

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Intro title card
        </Text>
        <Input
          value={branding.introText}
          onChange={(e) => onChange({ introText: e.target.value })}
          placeholder="e.g. Wait for it…"
          size="sm"
          borderRadius="lg"
          bg={theme.surface.subtle}
          borderColor={theme.surface.borderStrong}
          color={theme.text.primary}
        />
        {branding.introText && (
          <SettingSlider
            label="Duration"
            value={branding.introSeconds}
            min={0.5}
            max={5}
            step={0.5}
            valueLabel={`${branding.introSeconds}s`}
            onChange={(v) => onChange({ introSeconds: clampOverlaySeconds(v) })}
          />
        )}
      </VStack>

      <VStack align="stretch" gap={2}>
        <Text fontSize="sm" color={theme.text.onBrandMuted}>
          Outro CTA card
        </Text>
        <Input
          value={branding.outroText}
          onChange={(e) => onChange({ outroText: e.target.value })}
          placeholder="e.g. Follow for more"
          size="sm"
          borderRadius="lg"
          bg={theme.surface.subtle}
          borderColor={theme.surface.borderStrong}
          color={theme.text.primary}
        />
        {branding.outroText && (
          <SettingSlider
            label="Duration"
            value={branding.outroSeconds}
            min={0.5}
            max={5}
            step={0.5}
            valueLabel={`${branding.outroSeconds}s`}
            onChange={(v) => onChange({ outroSeconds: clampOverlaySeconds(v) })}
          />
        )}
      </VStack>

      <SettingRow
        label="Progress bar overlay"
        control={
          <ModernSwitch
            checked={branding.showProgressBar}
            onCheckedChange={(v) => onChange({ showProgressBar: v })}
          />
        }
      />
    </SettingSection>
  );
};
