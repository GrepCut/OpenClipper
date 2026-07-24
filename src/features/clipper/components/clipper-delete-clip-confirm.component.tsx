import React, { useState } from "react";
import { Box, HStack, Menu } from "@chakra-ui/react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { MainButton } from "../../../shared/components/buttons/main-button.component";
import { useClipperUi } from "../shared/use-clipper-ui.hook";

const CONFIRM_BUTTON_PROPS = {
  h: "32px",
  minH: "32px",
  fontSize: "xs",
  px: 3,
  borderRadius: "2xl" as const,
};

interface ClipperDeleteClipConfirmProps {
  onConfirm: () => void;
  children: React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>;
}

export const ClipperDeleteClipConfirm: React.FC<ClipperDeleteClipConfirmProps> = ({
  onConfirm,
  children,
}) => {
  const { theme } = useClipperUi();
  const [open, setOpen] = useState(false);

  const stopRowClick = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <Box flexShrink={0} onClick={stopRowClick}>
      <Menu.Root
        open={open}
        onOpenChange={(details) => setOpen(details.open)}
        positioning={{ placement: "top-end", gutter: 6 }}
        closeOnSelect={false}
      >
        <Menu.Trigger asChild>
          {React.cloneElement(children, {
            onClick: (e: React.MouseEvent) => {
              stopRowClick(e);
              children.props.onClick?.(e);
            },
          })}
        </Menu.Trigger>
        <Menu.Positioner onClick={stopRowClick} zIndex={10}>
          <Menu.Content
            onClick={stopRowClick}
            borderRadius="2xl"
            border="1px solid"
            borderColor={theme.border.primary}
            bg={theme.background.tertiary}
            boxShadow={theme.shadow.panel}
            p={2}
          >
            <HStack gap={2}>
              <OutlinedActionButton
                {...CONFIRM_BUTTON_PROPS}
                onClick={(e) => {
                  stopRowClick(e);
                  setOpen(false);
                }}
              >
                Cancel
              </OutlinedActionButton>
              <MainButton
                {...CONFIRM_BUTTON_PROPS}
                bg={theme.status.danger}
                fontWeight="semibold"
                onClick={(e) => {
                  stopRowClick(e);
                  onConfirm();
                  setOpen(false);
                }}
                _hover={{
                  filter: "brightness(1.08)",
                  bg: theme.status.danger,
                  transform: "none",
                }}
              >
                Delete
              </MainButton>
            </HStack>
          </Menu.Content>
        </Menu.Positioner>
      </Menu.Root>
    </Box>
  );
};
