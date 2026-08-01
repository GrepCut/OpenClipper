"use client";

import {
  Toaster as ChakraToaster,
  Portal,
  Stack,
  Toast,
  createToaster,
  Box,
} from "@chakra-ui/react";
import { Global } from "@emotion/react";
import { motion } from "framer-motion";
import { useTheme } from "../../../theme";

export const toaster = createToaster({
  placement: "bottom-start",
  pauseOnPageIdle: true,
});

/* ── Animated dots loader (framer-motion, GPU-accelerated) ── */
const dotStyle = (mode: string): React.CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: mode === "dark" ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.4)",
  willChange: "transform, opacity",
});

const dotVariants = {
  animate: (i: number) => ({
    opacity: [0.3, 1, 0.3],
    transition: {
      duration: 1.2,
      repeat: Infinity,
      ease: "easeInOut" as const,
      delay: i * 0.16,
    },
  }),
};

const DotsLoader = ({ mode }: { mode: string }) => (
  <Box display="flex" alignItems="center" gap="5px" mr={1} flexShrink={0}>
    {[0, 1, 2].map((i) => (
      <motion.div
        key={i}
        custom={i}
        variants={dotVariants}
        animate="animate"
        style={dotStyle(mode)}
      />
    ))}
  </Box>
);

/* ── Status accent bar colors ── */
const accentColor: Record<string, string> = {
  success: "#34D399",
  error: "#F87171",
  loading: "#818CF8",
  info: "#60A5FA",
  warning: "#FBBF24",
};

/*
 * Global CSS targeting Ark UI's toast item wrapper.
 * Every toast (standard AND custom-rendered) is wrapped by the
 * toaster in a <div data-state="open|closed"> container.
 * By targeting that wrapper we get enter/exit animations for ALL
 * toasts without needing to wrap custom renders in Toast.Root.
 */
const toastGlobalStyles = `
  [data-scope="toast"] {
    z-index: 10000 !important;
  }
  [data-scope="toast"][data-part="root"] {
    transform-origin: bottom left;
    will-change: transform, opacity;
    contain: layout style;
    backface-visibility: hidden;
  }
  [data-scope="toast"][data-part="root"][data-state="open"] {
    animation: toastScaleIn 0.25s ease-out forwards;
  }
  [data-scope="toast"][data-part="root"][data-state="closed"] {
    animation: toastScaleOut 0.15s ease-in forwards;
  }

  @keyframes toastScaleIn {
    0%   { opacity: 0; transform: scale(0.95) translateY(4px); }
    100% { opacity: 1; transform: scale(1)    translateY(0); }
  }
  @keyframes toastScaleOut {
    0%   { opacity: 1; transform: scale(1)    translateY(0); }
    100% { opacity: 0; transform: scale(0.95) translateY(4px); }
  }
`;

export const Toaster = () => {
  const { mode } = useTheme();
  return (
    <Portal>
      <Global styles={toastGlobalStyles} />
      <ChakraToaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast: any) =>
          toast.render ? (
            toast.render()
          ) : (
            <Toast.Root
              width={{ base: "sm", md: "xs" }}
              maxW="sm"
              borderRadius="2xl"
              bg={mode === "dark" ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.92)"}
              backdropFilter="blur(12px)"
              color={mode === "dark" ? "white" : "gray.800"}
              p={0}
              overflow="hidden"
              boxShadow={mode === "dark" 
                ? "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)" 
                : "0 8px 32px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.06)"
              }
              border="1px solid"
              borderColor={mode === "dark" ? "whiteAlpha.100" : "blackAlpha.100"}
              userSelect="none"
              cursor="default"
              onMouseDown={(e: React.MouseEvent) => {
                if (e.button === 1) {
                  e.preventDefault();
                  toaster.dismiss(toast.id);
                }
              }}
            >
              {/* Accent left bar */}
              <Box
                position="absolute"
                left={0}
                top={0}
                bottom={0}
                w="2px"
                bg={accentColor[toast.type] ?? accentColor.info}
                borderLeftRadius="2xl"
              />

              <Box display="flex" alignItems="center" gap={2} px={3} py={2.5}>
                {toast.type === "loading" ? (
                  <DotsLoader mode={mode} />
                ) : (
                  <Toast.Indicator />
                )}
                <Stack gap="0.5" flex="1" maxWidth="100%">
                  {toast.title && (
                    <Toast.Title
                      fontWeight="700"
                      fontSize="12px"
                      letterSpacing="0.01em"
                      lineHeight="1.3"
                    >
                      {toast.title}
                    </Toast.Title>
                  )}
                  {toast.description && (
                    <Toast.Description
                      fontSize="11px"
                      lineHeight="1.4"
                      color={mode === "dark" ? "whiteAlpha.700" : "blackAlpha.700"}
                    >
                      {toast.description}
                    </Toast.Description>
                  )}
                </Stack>
                {toast.action && (
                  <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
                )}
                <Toast.CloseTrigger />
              </Box>
            </Toast.Root>
          )
        }
      </ChakraToaster>
    </Portal>
  );
};
