import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { FiUploadCloud } from "react-icons/fi";
import { clipperTheme } from "../shared/theme.util";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "../../../shared/utils/platform.util";

interface ClipperUploadProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Fill remaining viewport and center content (main idle state). */
  fill?: boolean;
}

/** Longer dashes than CSS `border: dashed` — stroke-dasharray controls length. */
function dashedBorderImage(stroke: string, radiusPx: number) {
  const s = encodeURIComponent(stroke);
  return `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='${radiusPx}' ry='${radiusPx}' stroke='${s}' stroke-width='2' stroke-dasharray='28 16' stroke-linecap='round'/%3e%3c/svg%3e")`;
}

export const ClipperUpload: React.FC<ClipperUploadProps> = ({
  onFile,
  disabled,
  fill = false,
}) => {
  const { theme } = useClipperUi();
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
    const path = await open({
      multiple: false,
      filters: [{ name: "Video", extensions: ["mp4", "mov", "webm", "mkv", "m4v"] }],
    });
    if (!path || Array.isArray(path)) return;
    const name = path.split(/[\\/]/).pop() || "video.mp4";
    const file = new File([], name, { type: "video/" + (name.split(".").pop() || "mp4") }) as File & {
      path: string;
    };
    file.path = path;
    onFile(file);
  }, [onFile]);

  const chooseFile = useCallback(() => {
    if (disabled) return;
    if (isTauri()) {
      void chooseNativeFile();
    } else {
      inputRef.current?.click();
    }
  }, [disabled, chooseNativeFile]);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isInput) return;

      e.preventDefault();
      chooseFile();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, chooseFile]);

  const stroke = dragActive ? clipperTheme.accentGlow : theme.surface.focus;
  const radiusPx = 28;
  const borderImage = useMemo(() => dashedBorderImage(stroke, radiusPx), [stroke]);
  const idleBg = fill ? "transparent" : theme.surface.inset;
  const activeBg = `rgba(${clipperTheme.accentTintRgb},0.1)`;
  const hoverBg = `rgba(${clipperTheme.accentTintRgb},0.06)`;

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
      w="full"
      minH={fill ? { base: "calc(100dvh - 130px)", md: "calc(100dvh - 150px)" } : { base: "220px", md: "280px" }}
      h={fill ? { base: "calc(100dvh - 130px)", md: "calc(100dvh - 150px)" } : undefined}
      borderRadius={`${radiusPx}px`}
      border="none"
      bgColor={dragActive ? activeBg : idleBg}
      backgroundImage={borderImage}
      backgroundSize="100% 100%"
      backgroundRepeat="no-repeat"
      cursor="pointer"
      onClick={(event: React.MouseEvent) => {
        if (!isTauri()) return;
        event.preventDefault();
        void chooseNativeFile();
      }}
      onKeyDown={(e) => {
        if (disabled || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        chooseFile();
      }}
      transition="background-color 0.2s ease, opacity 0.2s ease"
      _hover={{
        bgColor: hoverBg,
        backgroundImage: dashedBorderImage(clipperTheme.accentGlow, radiusPx),
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4,.mov,.webm,.mkv,.m4v"
        hidden
        onChange={(e) => emit(e.target.files)}
      />
      <VStack gap={4} px={8} textAlign="center">
        <Box color={clipperTheme.accentLight}>
          <FiUploadCloud size={84} />
        </Box>
        <VStack gap={1.5}>
          <Text fontSize={{ base: "lg", md: "xl" }} fontWeight="semibold" color={theme.text.primary} letterSpacing="-0.01em">
            Drop your video here
          </Text>
          <Text fontSize="sm" color={theme.text.muted}>
            Click or drag to start clipping
          </Text>
        </VStack>
      </VStack>
    </Box>
  );
};
