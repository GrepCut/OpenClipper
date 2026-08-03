import { useState } from "react";
import { Text, VStack } from "@chakra-ui/react";
import { isAxiosError } from "axios";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../theme";
import { hasOnlineAccountAccess } from "../../shared/auth/account-access.util";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { usersService } from "../../services/users.service";
import { appToast } from "../../shared/utils/toast.service";
import {
  StyledModal,
  StyledModalFooter,
} from "../../shared/components/styled-modal.component";
import { SpecificTitle } from "../../shared/fonts/specific-title.font";
import { StyledAlert } from "../../shared/components/ui/styled-alert.component";
import { ThemedInput } from "../../shared/components/ui/themed-input.component";

const CONFIRMATION_PHRASE = "DELETE";

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DeleteAccountModal({ isOpen, onClose }: DeleteAccountModalProps) {
  const { theme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isConfirmationValid = confirmation === CONFIRMATION_PHRASE;

  const handleClose = () => {
    if (!isLoading) {
      setConfirmation("");
      onClose();
    }
  };

  const handleDelete = async () => {
    if (!isConfirmationValid || !hasOnlineAccountAccess()) {
      return;
    }

    setIsLoading(true);
    try {
      await usersService.deleteAccount({ confirmation: CONFIRMATION_PHRASE });
      await logout();
      appToast.success("Account deleted", "Your account has been permanently removed.");
      navigate("/clipper", { replace: true });
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.status === 409 &&
        (error.response.data?.message === "SUBSCRIPTION_CANCEL_FAILED" ||
          String(error.response.data?.message ?? "").includes(
            "SUBSCRIPTION_CANCEL_FAILED",
          ))
      ) {
        appToast.error(
          "Subscription still active",
          "We could not cancel your Paddle subscription automatically. Cancel it in your billing portal first, then try again.",
        );
        return;
      }

      appToast.error("Error", "Failed to delete account. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Delete account"
      size="md"
      isLoading={isLoading}
      onFormSubmit={() => void handleDelete()}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={handleDelete}
          submitText="Delete account"
          isLoading={isLoading}
          submitDisabled={!isConfirmationValid}
          submitColorScheme="red"
        />
      }
    >
      <VStack gap={4} align="stretch">
        <SpecificTitle>
          This permanently deletes your account, clipper projects, exports, and
          settings.
        </SpecificTitle>

        <StyledAlert
          status="warning"
          title="Active subscription"
          description="If you have a Paddle subscription, it will be canceled immediately as part of account deletion."
        />

        <StyledAlert
          status="error"
          title="Permanent deletion"
          description="This action is irreversible. You will need a new account to use Open Clipper again."
        />

        <VStack align="stretch" gap={1.5}>
          <Text fontSize="sm" color={theme.text.primary} fontWeight="600">
            Type{" "}
            <Text as="span" color={theme.status.danger} fontWeight="700">
              {CONFIRMATION_PHRASE}
            </Text>{" "}
            to confirm
          </Text>
          <ThemedInput
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
            placeholder={CONFIRMATION_PHRASE}
            autoComplete="off"
            spellCheck={false}
            aria-label={`Type ${CONFIRMATION_PHRASE} to confirm account deletion`}
          />
        </VStack>
      </VStack>
    </StyledModal>
  );
}
