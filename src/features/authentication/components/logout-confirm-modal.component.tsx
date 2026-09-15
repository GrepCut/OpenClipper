import { Text } from "@chakra-ui/react";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { useTheme } from "../../../theme";

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LogoutConfirmModal({ isOpen, onClose }: LogoutConfirmModalProps) {
  const { theme } = useTheme();
  const { logout, isLoggingOut } = useAuth();

  const handleClose = () => {
    if (!isLoggingOut) {
      onClose();
    }
  };

  const handleLogout = async () => {
    await logout();
    onClose();
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Log out?"
      size="sm"
      isLoading={isLoggingOut}
      onFormSubmit={() => void handleLogout()}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={() => void handleLogout()}
          cancelText="Cancel"
          submitText="Log out"
          submitColorScheme="red"
          isLoading={isLoggingOut}
        />
      }
    >
      <Text fontSize="sm" color={theme.text.muted}>
        You'll need to sign in again to use integrations and cloud features.
      </Text>
    </StyledModal>
  );
}
