import React, { useCallback } from "react";
import { Box, HStack, Input, Text, Textarea, VStack } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { appToast } from "../../../shared/utils/toast.service";
import { useClipperExportMetadata } from "../hooks/use-clipper-export-metadata.hook";
import {
  countMissingSocialFields,
  EXPORT_SOCIAL_FIELD_LABELS,
  type ExportSocialFields,
} from "../persistence/clipper-export-social.util";
import { groupTimestampedTranscriptForInlineDisplay } from "../persistence/export-transcript.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import type { ClipperFormatResult } from "../shared/state.util";

interface ClipperExportMetadataPanelProps {
  result: ClipperFormatResult;
  onMetadataSaved: (exportId: string, fields: ExportSocialFields) => void;
  /** Folder-only formats: show fields, but do not allow editing. */
  readOnly?: boolean;
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
    opacity: disabled ? 0.55 : 1,
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
  readOnly = false,
}) => {
  const { theme } = useClipperUi();
  const {
    canEdit,
    fields,
    updateField,
    save,
    dirty,
    isSaving,
  } = useClipperExportMetadata({ result, onMetadataSaved, watchExternal: true });
  const fieldsLocked = !canEdit || readOnly;
  const transcriptPlain = result.transcriptPlain?.trim() ?? "";
  const transcriptTimestamped = result.transcriptTimestamped?.trim() ?? "";
  const missingCount = readOnly ? 0 : countMissingSocialFields(result);

  const handleCopyExportId = useCallback(() => {
    void copyToClipboard(result.id, "Export ID copied");
  }, [result.id]);
  return (
    <VStack align="stretch" gap={3} w="full">
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

      <VStack align="stretch" gap={3} w="full">
        <Box w="full">
          <MetadataFieldLabel>Transcript</MetadataFieldLabel>
          <TranscriptDisplay
            plain={transcriptPlain}
            timestamped={transcriptTimestamped}
          />
        </Box>

        {!canEdit && !readOnly ? (
          <Text fontSize="xs" color={theme.text.muted}>
            Social metadata editing is available in the desktop app.
          </Text>
        ) : null}

        <SocialField
          label={EXPORT_SOCIAL_FIELD_LABELS.socialTitle}
          value={fields.socialTitle ?? ""}
          disabled={fieldsLocked}
          onChange={(value) => updateField("socialTitle", value)}
        />
        <SocialField
          label={EXPORT_SOCIAL_FIELD_LABELS.socialDescription}
          value={fields.socialDescription ?? ""}
          multiline
          disabled={fieldsLocked}
          onChange={(value) => updateField("socialDescription", value)}
        />
        <SocialField
          label={EXPORT_SOCIAL_FIELD_LABELS.socialHashtags}
          value={fields.socialHashtags ?? ""}
          disabled={fieldsLocked}
          onChange={(value) => updateField("socialHashtags", value)}
        />

        <HStack gap={2} flexWrap="wrap">
          {canEdit && !readOnly ? (
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
    </VStack>
  );
};