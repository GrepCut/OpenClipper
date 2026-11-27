import { useEffect, useState } from "react";
import type { ButtonProps } from "@chakra-ui/react";
import { downloadDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FolderOpen } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { isTauri } from "../../../shared/utils/platform.util";
import { appToast } from "../../../shared/utils/toast.service";
import { isPathInside } from "../platform/native-source.util";

/** Shows a downloaded source video in the file explorer. Renders nothing for other videos. */
export function ClipperSourceRevealButton({
  path,
  verifiedDownloaded = false,
  ...props
}: { path: string; verifiedDownloaded?: boolean } & ButtonProps) {
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri() || verifiedDownloaded) return;
    let current = true;
    void downloadDir()
      .then((directory) => {
        if (current && isPathInside(path, directory)) setDownloadedPath(path);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [path, verifiedDownloaded]);

  if (verifiedDownloaded ? !isTauri() : downloadedPath !== path) return null;

  return (
    <OutlinedActionButton
      type="button"
      startIcon={<FolderOpen size={16} />}
      whiteSpace="nowrap"
      {...props}
      onClick={() => {
        void revealItemInDir(path).catch(() => {
          appToast.error("Reveal in folder failed", "Could not find the video file.");
        });
      }}
    >
      Reveal in folder
    </OutlinedActionButton>
  );
}
