import { useState } from "react";
import { VStack } from "@chakra-ui/react";
import { removeClipperProjectDataDir } from "../persistence/project-data-files";
import { type Project, projectsService } from "../../../services/projects.service";
import { appToast } from "../../../shared/utils/toast.service";
import {
  StyledModal,
  StyledModalFooter,
} from "../../../shared/components/StyledModal";
import { SpecificTitle } from "../../../shared/fonts/specific-title.font";
import { StyledAlert } from "../../../shared/components/ui/styled-alert";

interface DeleteClipperProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  onProjectDeleted: () => void;
  onBeforeDelete?: () => Promise<void>;
}

export function DeleteClipperProjectModal({
  isOpen,
  onClose,
  project,
  onProjectDeleted,
  onBeforeDelete,
}: DeleteClipperProjectModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      if (onBeforeDelete) {
        await onBeforeDelete();
      }
      if (project.projectType === "clipper") {
        await removeClipperProjectDataDir(project.id);
      }
      await projectsService.delete(project.id);

      appToast.success("Project deleted", `Project "${project.name}" was successfully deleted`);

      onProjectDeleted();
    } catch (error) {
      appToast.error("Error", "Failed to delete project");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
    }
  };

  return (
    <StyledModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Delete Project"
      size="md"
      isLoading={isLoading}
      footer={
        <StyledModalFooter
          onCancel={handleClose}
          onSubmit={handleDelete}
          submitText="Delete Project"
          isLoading={isLoading}
          submitColorScheme="red"
        />
      }
    >
      <VStack gap={4} align="stretch">
        <SpecificTitle>
          Are you sure you want to delete project{" "}
          <strong>"{project.name}"</strong>?
        </SpecificTitle>

        {project.googleDriveFolderId && (
          <StyledAlert
            status="warning"
            title="Google Drive Folder"
            description="This project has a Google Drive folder configured. The folder and its contents will remain in Google Drive after project deletion."
          />
        )}

        <StyledAlert
          status="error"
          title="Permanent deletion"
          description="This action is irreversible! All data associated with this project will be permanently lost."
        />
      </VStack>
    </StyledModal>
  );
}
