import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Flex } from "@chakra-ui/react";
import { Play, X } from "lucide-react";

interface ClipperExportPlayerProps {
  src: string;
  width: number;
  height: number;
  title?: string;
}

/** Thumbnail that opens the export in a fullscreen lightbox, like an image viewer. */
export const ClipperExportPlayer: React.FC<ClipperExportPlayerProps> = ({
  src,
  width,
  height,
  title,
}) => {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  return (
    <>
      <Box
        as="button"
        role="group"
        aria-label={title ? `Play ${title}` : "Play export"}
        onClick={() => setOpen(true)}
        w={`${width}px`}
        h={`${height}px`}
        position="relative"
        display="block"
        bg="black"
        cursor="pointer"
        overflow="hidden"
      >
        <video
          src={`${src}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            pointerEvents: "none",
          }}
        />
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          bg="blackAlpha.200"
          transition="background 0.15s"
          _groupHover={{ bg: "blackAlpha.400" }}
        >
          <Flex
            align="center"
            justify="center"
            w="40px"
            h="40px"
            borderRadius="full"
            bg="blackAlpha.700"
            color="white"
            border="1px solid"
            borderColor="whiteAlpha.400"
            transition="transform 0.15s"
            _groupHover={{ transform: "scale(1.1)" }}
          >
            <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />
          </Flex>
        </Flex>
      </Box>

      {open
        ? createPortal(
            <Flex
              role="dialog"
              aria-modal="true"
              aria-label={title ?? "Export preview"}
              position="fixed"
              inset={0}
              zIndex={2000}
              align="center"
              justify="center"
              bg="blackAlpha.900"
              p={{ base: 3, md: 8 }}
              onClick={close}
            >
              <Box
                as="button"
                aria-label="Close"
                onClick={(event: React.MouseEvent) => {
                  event.stopPropagation();
                  close();
                }}
                position="absolute"
                top={4}
                right={4}
                display="flex"
                alignItems="center"
                justifyContent="center"
                w="40px"
                h="40px"
                borderRadius="full"
                bg="whiteAlpha.200"
                color="white"
                cursor="pointer"
                transition="background 0.15s"
                _hover={{ bg: "whiteAlpha.400" }}
              >
                <X size={22} />
              </Box>
              <video
                src={src}
                controls
                autoPlay
                playsInline
                onClick={(event) => event.stopPropagation()}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  borderRadius: 8,
                  background: "black",
                  outline: "none",
                  boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
                }}
              />
            </Flex>,
            document.body,
          )
        : null}
    </>
  );
};
