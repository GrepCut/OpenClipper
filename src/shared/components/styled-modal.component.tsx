import { Dialog, Box, Flex, Portal, Tooltip } from "@chakra-ui/react";
import { cloneElement, isValidElement, useId } from "react";
import type { CSSProperties, ReactElement, ReactNode, SyntheticEvent } from "react";
import { useTheme } from '../../theme';
import { SecondaryMainTitle } from "../fonts/secondary-main-title.font";
import { MainButton } from "./buttons/main-button.component";
import { colors } from "../../theme/colors.util";

interface StyledModalFooterProps {
  onCancel: () => void;
  onSubmit: () => void;
  cancelText?: string;
  submitText?: string;
  isLoading?: boolean;
  submitDisabled?: boolean;
  submitTitle?: string;
  submitColorScheme?: string;
  submitFormId?: string;
}

interface StyledModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "cover" | "full";
  placement?: "center" | "top" | "bottom";
  isLoading?: boolean;
  closeOnOverlayClick?: boolean;
  scrollBehavior?: "inside" | "outside";
  zIndex?: number;
  onFormSubmit?: () => void;
  /** Overrides default dialog width, e.g. `min(calc(100vw - 64px), 1280px)`. */
  contentWidth?: string;
}

type TauriNoDragStyle = CSSProperties & {
  WebkitAppRegion?: "no-drag";
};

function getFooterSubmitProps(footer: ReactNode): StyledModalFooterProps | null {
  if (!isValidElement(footer)) return null;
  const props = footer.props as Partial<StyledModalFooterProps>;
  if (typeof props.onSubmit !== "function" || typeof props.onCancel !== "function") {
    return null;
  }
  return props as StyledModalFooterProps;
}

export function StyledModal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  placement = "center",
  isLoading = false,
  closeOnOverlayClick = true,
  scrollBehavior = "inside",
  zIndex = 9999,
  onFormSubmit,
  contentWidth,
}: StyledModalProps) {
  const { theme, mode } = useTheme();
  const formId = useId();
  const footerSubmit = getFooterSubmitProps(footer);
  const isDestructiveFooter = footerSubmit?.submitColorScheme === "red";
  const effectiveFormSubmit =
    onFormSubmit ?? (isDestructiveFooter ? undefined : footerSubmit?.onSubmit);

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

  const handleFormSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || footerSubmit?.submitDisabled) return;
    effectiveFormSubmit?.();
  };

  const footerContent =
    footer && effectiveFormSubmit && footerSubmit && isValidElement(footer)
      ? cloneElement(footer as ReactElement<StyledModalFooterProps>, { submitFormId: formId })
      : footer;

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
            p={0}
            w={contentWidth}
            maxW={contentWidth}
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
              <Dialog.Header px={3} pt={3} pb={2}>
                <Flex w="full" align="center" columnGap={4} rowGap={1} wrap="wrap">
                  <Dialog.Title color={theme.text.primary}>
                    <SecondaryMainTitle fontSize="2xl">
                      {title}
                    </SecondaryMainTitle>
                  </Dialog.Title>
                  {description ? (
                    <Dialog.Description
                      fontSize="xs"
                      color={theme.text.muted}
                      lineHeight="1.5"
                      textAlign="right"
                      ml="auto"
                      flex="1 1 16rem"
                      minW={0}
                    >
                      {description}
                    </Dialog.Description>
                  ) : null}
                </Flex>
              </Dialog.Header>

              {effectiveFormSubmit ? (
                <Dialog.Body
                  color={theme.text.primary}
                  px={3}
                  pt={1}
                  pb={3}
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
                  <Box asChild display="contents">
                    <form id={formId} onSubmit={handleFormSubmit}>
                      {children}
                    </form>
                  </Box>
                </Dialog.Body>
              ) : (
                <Dialog.Body
                  color={theme.text.primary}
                  px={3}
                  pt={1}
                  pb={3}
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
              )}

              {!isLoading && <Dialog.CloseTrigger />}
            </Box>

            {footerContent && (
              <Dialog.Footer px={3} pt={2} pb={3}>
                {footerContent}
              </Dialog.Footer>
            )}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}

export function StyledModalFooter({
  onCancel,
  onSubmit,
  cancelText = "Cancel",
  submitText = "Save",
  isLoading = false,
  submitDisabled = false,
  submitTitle,
  submitColorScheme = "blue",
  submitFormId,
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
  const submitButtonDisabled = submitDisabled || isLoading;

  const submitButton = (
    <MainButton
      type={submitFormId ? "submit" : "button"}
      form={submitFormId}
      onClick={submitFormId ? undefined : onSubmit}
      disabled={submitButtonDisabled}
      h="33px"
      fontSize="md"
      px={5}
      bg={submitColors.gradient}
      boxShadow={submitColors.boxShadow}
      pointerEvents={submitTitle ? "none" : undefined}
      _hover={{
        filter: `brightness(${submitColors.hoverBrightness})`,
        transform: "translateY(-1px)",
        boxShadow: submitColors.boxShadow !== "none" ? "0 6px 16px rgba(229, 62, 62, 0.3)" : "none",
        _disabled: { transform: "none" },
      }}
    >
      {submitText}
    </MainButton>
  );

  return (
    <>
      <MainButton
        type="button"
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
      {submitTitle ? (
        <Tooltip.Root openDelay={200} closeDelay={100}>
          <Tooltip.Trigger asChild>
            <Box as="span" display="inline-block">
              {submitButton}
            </Box>
          </Tooltip.Trigger>
          <Portal>
            <Tooltip.Positioner>
              <Tooltip.Content
                px={3}
                py={2}
                borderRadius="lg"
                bg={theme.background.secondary}
                color={theme.text.primary}
                borderWidth="1px"
                borderColor={theme.border.primary}
                boxShadow={theme.shadow.dropdown}
                maxW="280px"
                fontSize="sm"
              >
                {submitTitle}
              </Tooltip.Content>
            </Tooltip.Positioner>
          </Portal>
        </Tooltip.Root>
      ) : (
        submitButton
      )}
    </>
  );
}
