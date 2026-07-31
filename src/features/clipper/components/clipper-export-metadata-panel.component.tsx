import React, { useCallback, useState } from "react";
import { Box, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronUp, Copy } from "lucide-react";
import {
  OutlinedActionButton,
  getOutlinedActionSurfaceProps,
} from "../../../shared/components/buttons/outlined-action-button.component";
import { appToast } from "../../../shared/utils/toast.service";
import { useClipperExportMetadata } from "../hooks/use-clipper-export-metadata.hook";
import {
  countMissingSocialFields,
  EXPORT_SOCIAL_FIELD_LABELS,
  type ExportSocialFields,
} from "../persistence/clipper-export-social.util";import { groupTimestampedTranscriptForInlineDisplay } from "../persistence/export-transcript.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";

interface ClipperExportMetadataPanelProps {
  result: ClipperFormatResult;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
  /** collapsible = toggle in session exports; inline = always visible (Publish detail) */
  variant?: "collapsible" | "inline";
}

function MetadataFieldLabel({ children }: { children: React.ReactNode }) {
  const { theme } = useClipperUi();
  return (
    <Text fontSize="xs" fontWeight="semibold" color={theme.text.muted} mb={1}>
      {children}
    </Text>
  );
}

function SocialField({
  label,
  value,
  multiline = false,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  multiline?: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { theme } = useClipperUi();
  const sharedProps = {
    size: "sm" as const,
    bg: theme.background.surface,
    borderColor: theme.surface.hover,
    color: theme.text.onBrandMuted,
    value,
    disabled,
    readOnly: disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };

  return (
    <Box w="full">
      <MetadataFieldLabel>{label}</MetadataFieldLabel>
      {multiline ? (
        <Textarea {...sharedProps} rows={3} resize="vertical" />
      ) : (
        <Input {...sharedProps} />
      )}
    </Box>
  );
}

async function copyToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    appToast.success(successMessage);
  } catch {
    appToast.error("Clipboard copy failed");
  }
}

function TranscriptDisplay({
  plain,
  timestamped,
}: {
  plain: string;
  timestamped: string;
}) {
  const { theme } = useClipperUi();
  const chunks = React.useMemo(() => {
    const trimmedTimestamped = timestamped.trim();
    if (trimmedTimestamped) {
      return groupTimestampedTranscriptForInlineDisplay(trimmedTimestamped);
    }
    const trimmedPlain = plain.trim();
    return trimmedPlain ? [{ timestamp: "", text: trimmedPlain }] : [];
  }, [plain, timestamped]);

  if (chunks.length === 0) {
    return (
      <Text fontSize="sm" color={theme.text.muted} fontStyle="italic">
        No transcript saved for this export.
      </Text>
    );
  }

  return (
    <Box
      borderRadius="lg"
      border="1px solid"
      borderColor={theme.surface.hover}
      bg={theme.surface.faint}
      p={3}
      maxH="200px"
      overflow="auto"
    >
      <Text fontSize="sm" lineHeight="1.6">
        {chunks.map((chunk, index) => (
          <React.Fragment key={`${chunk.timestamp}-${index}`}>
            {index > 0 ? " " : null}
            {chunk.timestamp ? (
              <Text
                as="span"
                color={theme.text.muted}
                fontFamily="mono"
                fontSize="xs"
                mr={1}
              >
                [{chunk.timestamp}]
              </Text>
            ) : null}
            <Text as="span" color={theme.text.primary}>
              {chunk.text}
            </Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}

export const ClipperExportMetadataPanel: React.FC<ClipperExportMetadataPanelProps> = ({
  result,
  onMetadataSaved,
  variant = "collapsible",
}) => {
  const { theme } = useClipperUi();
  const isInline = variant === "inline";
  const [expanded, setExpanded] = useState(isInline);
  const showContent = isInline || expanded;
  const {
    canEdit,
    fields,
    updateField,
    save,
    dirty,
    isSaving,
  } = useClipperExportMetadata({ result, onMetadataSaved, watchExternal: showContent });
  const transcriptPlain = result.transcriptPlain?.trim() ?? "";
  const transcriptTimestamped = result.transcriptTimestamped?.trim() ?? "";
  const missingCount = countMissingSocialFields(result);

  const handleCopyExportId = useCallback(() => {
    void copyToClipboard(result.id, "Export ID copied");
  }, [result.id]);
  return (
    <VStack align="stretch" gap={3} w="full" mt={isInline ? 0 : 2}>
      {isInline ? (
        <HStack justify="space-between" align="center">
          <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
            Export metadata
          </Text>
          {missingCount > 0 ? (
            <Text fontSize="xs" color={theme.text.muted}>
              {missingCount} empty
            </Text>
          ) : null}
        </HStack>
      ) : (
        <OutlinedActionButton
          type="button"
          width="fit-content"
          justifyContent="flex-start"
          gap={2}
          px={3}
          py={1}
          h="auto"
          minH="32px"
          fontSize="xs"
          color={theme.text.muted}
          {...getOutlinedActionSurfaceProps(theme, expanded)}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Export metadata
          {missingCount > 0 ? (
            <Text as="span" fontSize="xs" color={theme.text.muted}>
              · {missingCount} empty
            </Text>
          ) : null}
        </OutlinedActionButton>
      )}

      {showContent ? (
        <VStack align="stretch" gap={3} w="full">
          <Box w="full">
            <MetadataFieldLabel>Transcript</MetadataFieldLabel>
            <TranscriptDisplay
              plain={transcriptPlain}
              timestamped={transcriptTimestamped}
            />
          </Box>

          {!canEdit ? (
            <Text fontSize="xs" color={theme.text.muted}>
              Social metadata editing is available in the desktop app.
            </Text>
          ) : null}

          <SocialField
            label={EXPORT_SOCIAL_FIELD_LABELS.socialTitle}
            value={fields.socialTitle ?? ""}
            disabled={!canEdit}
            onChange={(value) => updateField("socialTitle", value)}
          />
          <SocialField
            label={EXPORT_SOCIAL_FIELD_LABELS.socialShortDescription}
            value={fields.socialShortDescription ?? ""}
            disabled={!canEdit}
            onChange={(value) => updateField("socialShortDescription", value)}
          />
          <SocialField
            label={EXPORT_SOCIAL_FIELD_LABELS.socialDescription}
            value={fields.socialDescription ?? ""}
            multiline
            disabled={!canEdit}
            onChange={(value) => updateField("socialDescription", value)}
          />
          <SocialField
            label={EXPORT_SOCIAL_FIELD_LABELS.socialDescriptionTimestamped}
            value={fields.socialDescriptionTimestamped ?? ""}
            multiline
            disabled={!canEdit}
            onChange={(value) => updateField("socialDescriptionTimestamped", value)}
          />
          <SocialField
            label={EXPORT_SOCIAL_FIELD_LABELS.socialHashtags}
            value={fields.socialHashtags ?? ""}
            disabled={!canEdit}
            onChange={(value) => updateField("socialHashtags", value)}
          />

          <HStack gap={2} flexWrap="wrap">
            {canEdit ? (
              <OutlinedActionButton
                type="button"
                width="fit-content"
                justifyContent="center"
                gap={2}
                disabled={!dirty || isSaving}
                onClick={() => void save()}
              >
                {isSaving ? "Saving…" : "Save"}
              </OutlinedActionButton>
            ) : null}
            <OutlinedActionButton
              type="button"
              width="fit-content"
              justifyContent="center"
              gap={2}
              startIcon={<Copy size={14} />}
              onClick={handleCopyExportId}
            >
              Copy export ID
            </OutlinedActionButton>
          </HStack>
        </VStack>
      ) : null}
    </VStack>
  );
};