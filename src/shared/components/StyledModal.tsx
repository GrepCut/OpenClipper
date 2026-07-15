import { Dialog, Box, Portal } from "@chakra-ui/react";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import { useTheme } from '../../theme';
import { SecondaryMainTitle } from "../fonts/secondary-main-title.font";
import { MainButton } from "./buttons/main-button";
import { colors } from "../../theme/colors";

interface StyledModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "cover" | "full";
  placement?: "center" | "top" | "bottom";
  isLoading?: boolean;
  closeOnOverlayClick?: boolean;
  scrollBehavior?: "inside" | "outside";
  zIndex?: number;
}

type TauriNoDragStyle = CSSProperties & {
  WebkitAppRegion?: "no-drag";
};

export function StyledModal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = "md",
  placement = "center",
  isLoading = false,
  closeOnOverlayClick = true,
  scrollBehavior = "inside",
  zIndex = 9999,
}: StyledModalProps) {
  const { theme, mode } = useTheme();

  const nonDraggableArea: TauriNoDragStyle = {
    WebkitAppRegion: "no-drag",
  };

  const stopToolbarDragPropagation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const handleOpenChange = (details: { open: boolean }) => {
    if (!details.open && !isLoading && closeOnOverlayClick) {
      onClose();
    }
  };

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={handleOpenChange}
      size={size}
      placement={placement}
      scrollBehavior={scrollBehavior}
    >
      <Portal>
        <Dialog.Backdrop
          style={{
            backdropFilter: "blur(12px)",
            zIndex: zIndex - 1,
            ...nonDraggableArea,
          }}
          onMouseDown={stopToolbarDragPropagation}
          onPointerDown={stopToolbarDragPropagation}
          onDoubleClick={stopToolbarDragPropagation}
        />
        <Dialog.Positioner
          zIndex={zIndex}
          style={nonDraggableArea}
          onMouseDown={stopToolbarDragPropagation}
          onPointerDown={stopToolbarDragPropagation}
          onDoubleClick={stopToolbarDragPropagation}
        >
          <Dialog.Content
            bg={theme.dashboard.gradientCard}
            border="1px solid"
            borderColor={theme.dashboard.border}
            borderRadius="2xl"
            boxShadow="0 8px 32px rgba(0,0,0,0.4)"
            p={4}
            maxH={scrollBehavior === "inside" ? "85vh" : undefined}
            display="flex"
            flexDirection="column"
            style={nonDraggableArea}
            onMouseDown={stopToolbarDragPropagation}
            onPointerDown={stopToolbarDragPropagation}
            onDoubleClick={stopToolbarDragPropagation}
          >
            <Box
              borderRadius="2xl"
              display="flex"
              flexDirection="column"
              overflow="hidden"
              flex="1"
              position="relative"
            >
              <Dialog.Header>
                <Dialog.Title color={theme.text.primary}>
                  <SecondaryMainTitle fontSize="2xl">
                    {title}
                  </SecondaryMainTitle>
                </Dialog.Title>
              </Dialog.Header>

              <Dialog.Body
                color={theme.text.primary}
                overflowY={scrollBehavior === "inside" ? "auto" : undefined}
                flex="1"
                css={{
                  "&::-webkit-scrollbar": {
                    width: "4px",
                  },
                  "&::-webkit-scrollbar-track": {
                    width: "6px",
                  },
                  "&::-webkit-scrollbar-thumb": {
                    background: theme.dashboard.border,
                    borderRadius: "24px",
                  },
                }}
              >
                {children}
              </Dialog.Body>

              {!isLoading && <Dialog.CloseTrigger />}
            </Box>

            {footer && (
              <Dialog.Footer padding="0" paddingTop={4}>
                {footer}
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

interface StyledModalFooterProps {
  onCancel: () => void;
  onSubmit: () => void;
  cancelText?: string;
  submitText?: string;
  isLoading?: boolean;
  submitDisabled?: boolean;
  submitColorScheme?: string;
}

export function StyledModalFooter({
  onCancel,
  onSubmit,
  cancelText = "Cancel",
  submitText = "Save",
  isLoading = false,
  submitDisabled = false,
  submitColorScheme = "blue",
}: StyledModalFooterProps) {
  const { theme } = useTheme();

  const getColorScheme = (scheme: string) => {
    switch (scheme) {
      case "red":
        return {
          gradient: "linear-gradient(to right, #E53E3E, #C53030)",
          hoverBrightness: 1.2,
          boxShadow: "0 4px 12px rgba(229, 62, 62, 0.2)",
        };
      case "blue":
        return {
          hoverBrightness: 1.1,
          boxShadow: "none",
        };
      default:
        return {
          gradient: `linear-gradient(to right, ${colors.purple.medium}, ${colors.purple.accent1})`,
          hoverBrightness: 1.1,
          boxShadow: "none",
        };
    }
  };

  const submitColors = getColorScheme(submitColorScheme);

  return (
    <>
      <MainButton
        onClick={onCancel}
        disabled={isLoading}
        h="33px"
        fontSize="md"
        px={5}
        bg="transparent"
        color={theme.text.primary}
        _hover={{
          bg: theme.dashboard.border,
          transform: "translateY(-1px)",
          filter: "none",
          _disabled: { transform: "none", bg: "transparent" },
        }}
        _active={{
          transform: "translateY(0)",
        }}
      >
        {cancelText}
      </MainButton>
      <MainButton
        onClick={onSubmit}
        disabled={submitDisabled || isLoading}
        h="33px"
        fontSize="md"
        px={5}
        bg={submitColors.gradient}
        boxShadow={submitColors.boxShadow}
        _hover={{
          filter: `brightness(${submitColors.hoverBrightness})`,
          transform: "translateY(-1px)",
          boxShadow: submitColors.boxShadow !== "none" ? "0 6px 16px rgba(229, 62, 62, 0.3)" : "none",
          _disabled: { transform: "none" },
        }}
      >
        {submitText}
      </MainButton>
    </>
  );
}
