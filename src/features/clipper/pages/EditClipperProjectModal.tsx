import { useState, useEffect } from "react";
import { Field, Input, Textarea, VStack } from "@chakra-ui/react";
import { type Project, projectsService } from "../../../services/projects.service";
import { appToast } from "../../../shared/utils/toast.service";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/StyledModal";
import { useTheme } from "../../../theme";
import { SpecificTitle } from "../../../shared/fonts/specific-title.font";

interface EditClipperProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  onProjectUpdated: () => void;
}

export function EditClipperProjectModal({
  isOpen,
  onClose,
  project,
  onProjectUpdated,
}: EditClipperProjectModalProps) {
  const { theme } = useTheme();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
  });
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && project) {
      setFormData({
        name: project.name,
        description: project.description || "",
      });
    }
  }, [isOpen, project]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      appToast.error("Validation Error", "Project name is required");
      return;
    }

    setIsLoading(true);
    try {
      await projectsService.update(project.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
      });

      appToast.success("Project updated", "The project has been successfully updated");

      onProjectUpdated();
    } catch (error) {
      appToast.error("Error", "Failed to update project");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setFormData({ name: "", description: "" });
      onClose();
    }
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Project"
      size="lg"
      isLoading={isLoading}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={handleSubmit}
          submitText="Save changes"
          isLoading={isLoading}
        />
      }
    >
      <VStack gap={4}>
        <Field.Root required>
          <Field.Label color={theme.text.muted}>
            <SpecificTitle fontSize="sm">Project Name</SpecificTitle>
          </Field.Label>
          <Input
            value={formData.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
            placeholder="Enter project name"
            disabled={isLoading}
            borderRadius="2xl"
          />
        </Field.Root>
        <Field.Root>
          <Field.Label color={theme.text.muted}>
            <SpecificTitle fontSize="sm">Description</SpecificTitle>
          </Field.Label>
          <Textarea
            value={formData.description}
            onChange={(e) => handleInputChange("description", e.target.value)}
            placeholder="Enter project description (optional)"
            rows={4}
            disabled={isLoading}
            borderRadius="2xl"
          />
        </Field.Root>
      </VStack>
    </StyledModal>
  );
}
