import { Text, VStack } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { useTheme } from "../../../theme";
import { formatDownloadCaption } from "../shared/logger.util";
import { ClipperProgressBar } from "./clipper-progress-bar.component";

interface ClipperFirstRunLocalModelProps {
  name: string;
  buttonLabel?: string;
  installedLabel?: string;
  downloading: boolean;
  downloadProgress: number | null;
  downloadReceived: number | null;
  downloadTotal: number | null;
  showDownload: boolean;
  installed: boolean;
  error: string | null;
  downloadDisabled?: boolean;
  onDownload: () => void;
}

export function ClipperFirstRunLocalModel({
  name,
  buttonLabel,
  installedLabel,
  downloading,
  downloadProgress,
  downloadReceived,
  downloadTotal,
  showDownload,
  installed,
  error,
  downloadDisabled = false,
  onDownload,
}: ClipperFirstRunLocalModelProps) {
  const { theme } = useTheme();
  return (
    <VStack align="stretch" gap={2}>
      {downloading && (
        <ClipperProgressBar
          label={`Downloading ${name}`}
          value={downloadProgress}
          caption={formatDownloadCaption(downloadReceived, downloadTotal)}
        />
      )}
      {showDownload && (
        <OutlinedActionButton
          startIcon={<Download size={16} />}
          onClick={onDownload}
          loading={downloading}
          disabled={downloadDisabled}
        >
          {buttonLabel ?? `Download ${name}`}
        </OutlinedActionButton>
      )}
      {installed && !downloading && (
        <Text fontSize="sm" color={theme.status.success}>
          {installedLabel ?? `${name} installed`}
        </Text>
      )}
      {error && (
        <Text fontSize="sm" color={theme.status.danger}>
          {error}
        </Text>
      )}
    </VStack>
  );
}
