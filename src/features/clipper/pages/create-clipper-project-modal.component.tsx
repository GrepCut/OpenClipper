import { useState } from "react";
import {
  Field,
  Input,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useNavigate } from "react-router-dom";
import { appToast } from "../../../shared/utils/toast.service";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/styled-modal.component";
import { StyledAlert } from "../../../shared/components/ui/styled-alert.component";
import { useTheme } from "../../../theme";
import { SpecificTitle } from "../../../shared/fonts/specific-title.font";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { createClipperProject } from "../persistence/bootstrap.util";

interface CreateClipperProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateClipperProjectModal({
  isOpen,
  onClose,
  onCreated,
}: CreateClipperProjectModalProps) {
  const { theme } = useTheme();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const handleClose = () => {
    setName("");
    setDescription("");
    setSubmissionError(null);
    setNameError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (isLoading) return;

    if (!name.trim()) {
      setNameError("Project name is required");
      return;
    }

    setIsLoading(true);
    setSubmissionError(null);
    setNameError(null);

    try {
      const project = await createClipperProject({
        name,
        description,
        token: token ?? "",
      });

      appToast.success("Success", "Clipper project created");
      handleClose();
      onCreated?.();
      navigate(`/clipper/${project.id}`);
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Failed to create Clipper project";
      setSubmissionError(errorMessage);
      appToast.error("Error", errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Clipper Project"
      size="lg"
      placement="center"
      isLoading={isLoading}
      onFormSubmit={() => void handleSubmit()}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={() => void handleSubmit()}
          submitText="Create project"
          isLoading={isLoading}
          submitDisabled={isLoading || !name.trim()}
        />
      }
    >
      <VStack gap={4} align="stretch">
        {submissionError && (
          <StyledAlert status="error" title="Creation Failed" description={submissionError} />
        )}

        <Field.Root required invalid={!!nameError}>
          <Field.Label color={theme.text.primary}>
            <SpecificTitle fontSize="sm">Project name</SpecificTitle>
          </Field.Label>
          <Input
            placeholder="e.g. Podcast episode 12"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (submissionError) setSubmissionError(null);
              if (nameError) setNameError(null);
            }}
            borderRadius="2xl"
            maxLength={255}
            disabled={isLoading}
          />
          {nameError && <Field.ErrorText>{nameError}</Field.ErrorText>}
        </Field.Root>

        <Field.Root>
          <Field.Label color={theme.text.primary}>
            <SpecificTitle fontSize="sm">Description (optional)</SpecificTitle>
          </Field.Label>
          <Textarea
            placeholder="Notes about this clip session"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            borderRadius="2xl"
            rows={3}
            resize="vertical"
            disabled={isLoading}
          />
        </Field.Root>
      </VStack>
    </StyledModal>
  );
}
