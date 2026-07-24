import React, { useCallback, useRef, useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { FiUploadCloud } from "react-icons/fi";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../../../shared/utils/platform.util";

interface ClipperUploadProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export const ClipperUpload: React.FC<ClipperUploadProps> = ({ onFile, disabled }) => {
  const { theme, panelShadow } = useClipperUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const emit = useCallback(
    (list: FileList | null) => {
      const file = list?.[0];
      if (inputRef.current) inputRef.current.value = "";
      if (file) onFile(file);
    },
    [onFile],
  );

  const chooseNativeFile = useCallback(async () => {
    const path = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "webm", "mkv", "m4v"] }] });
    if (!path || Array.isArray(path)) return;
    const name = path.split(/[\\/]/).pop() || "video.mp4";
    const file = new File([], name, { type: "video/" + (name.split(".").pop() || "mp4") }) as File & { path: string };
    file.path = path;
    onFile(file);
  }, [onFile]);

  return (
    <Box
      as="label"
      role="button"
      tabIndex={disabled ? -1 : 0}
      opacity={disabled ? 0.6 : 1}
      pointerEvents={disabled ? "none" : "auto"}
      onDragOver={(e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(true);
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        setDragActive(false);
        emit(e.dataTransfer.files);
      }}
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minH={{ base: "220px", md: "280px" }}
      borderRadius="3xl"
      border="2px dashed"
      borderColor={dragActive ? clipperTheme.accentGlow : theme.surface.focus}
      bg={dragActive ? `rgba(${clipperTheme.accentTintRgb},0.12)` : theme.surface.inset}
      boxShadow={panelShadow}
      cursor="pointer"
      onClick={(event: React.MouseEvent) => {
        if (!isTauri()) return;
        event.preventDefault();
        void chooseNativeFile();
      }}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        if (isTauri()) {
          void chooseNativeFile();
        } else {
          inputRef.current?.click();
        }
      }}
      transition="all 0.2s ease"
      _hover={{
        borderColor: clipperTheme.accentGlow,
        bg: `rgba(${clipperTheme.accentTintRgb},0.08)`,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
        hidden
        onChange={(e) => emit(e.target.files)}
      />
      <VStack gap={3} px={6} textAlign="center">
        <Box
          p={4}
          borderRadius="full"
          bg={`rgba(${clipperTheme.accentTintRgb},0.15)`}
          color={clipperTheme.accentLight}
        >
          <FiUploadCloud size={36} />
        </Box>
        <Text fontSize="xl" fontWeight="semibold" color={theme.text.primary}>
          Drop your long video here
        </Text>
        <Text fontSize="sm" color={theme.text.muted} maxW="420px">
          We&apos;ll transcribe it, clip the first 60 seconds, burn captions, and export
          Instagram, TikTok &amp; YouTube formats — right in your browser.
        </Text>
      </VStack>
    </Box>
  );
};
