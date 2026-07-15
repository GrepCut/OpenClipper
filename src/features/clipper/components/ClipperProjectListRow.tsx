import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Box, HStack, Progress, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { ArrowRight, Pencil, Trash2 } from "lucide-react";
import { type Project } from "../../../services/projects.service";
import { colors, useTheme } from "../../../theme";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { OutlinedActionButton } from "../../../shared/components/buttons/OutlinedActionButton";
import { EditClipperProjectModal } from "../pages/EditClipperProjectModal";
import { DeleteClipperProjectModal } from "../pages/DeleteClipperProjectModal";
import { clipperStageLabel } from "../shared/stages";
import { getClipperMetadataFromProject } from "../persistence/metadata-autosave";
function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface ClipperProjectListRowProps {
  project: Project;
  onUpdated: () => void;
  onDeleted: () => void;
}

export function ClipperProjectListRow({
  project,
  onUpdated,
  onDeleted,
}: ClipperProjectListRowProps) {
  const navigate = useNavigate();
  const { theme, mode } = useTheme();
  const metadata = getClipperMetadataFromProject(project.metadata);
  const stageLabel = clipperStageLabel(metadata.stage);
  const summary = project.clipperPipelineSummary ?? { completedSteps: 0, totalSteps: 4 };
  const progressPercent =
    summary.totalSteps > 0 ? (summary.completedSteps / summary.totalSteps) * 100 : 0;

  const {
    open: isEditOpen,
    onOpen: onEditOpen,
    onClose: onEditClose,
  } = useDisclosure();
  const {
    open: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  const rowBg = mode === "dark" ? theme.background.card : "gray.50";

  const handleOpen = useCallback(() => {
    navigate(`/clipper/${project.id}`);
  }, [navigate, project.id]);

  return (
    <>
      <Box
        bg={rowBg}
        borderRadius="2xl"
        p={{ base: 4, md: 5 }}
      >
        <HStack
          align={{ base: "stretch", md: "center" }}
          justify="space-between"
          gap={4}
          flexWrap={{ base: "wrap", lg: "nowrap" }}
        >
          <VStack align="start" gap={2} flex="1" minW={0}>
            <SecondaryMainTitle
              fontSize={{ base: "md", md: "lg" }}
              color={theme.text.primary}
              lineClamp={1}
            >
              {project.name}
            </SecondaryMainTitle>

            <HStack gap={2} flexWrap="wrap">
              <Box
                px={2}
                py={0.5}
                borderRadius="full"
                bg={mode === "dark" ? theme.brand.purpleSoftAlpha12 : theme.brand.toggleActiveBg}
                color={colors.purple.medium}
                fontSize="xs"
                fontWeight="semibold"
              >
                {stageLabel}
              </Box>
              <Text fontSize="xs" color={theme.text.muted}>
                {summary.completedSteps}/{summary.totalSteps} steps
              </Text>
            </HStack>

            <Box w="full" maxW="280px">
              <Progress.Root value={progressPercent} size="xs">
                <Progress.Track
                  bg={mode === "dark" ? theme.surface.active : theme.border.secondary}
                  borderRadius="full"
                >
                  <Progress.Range bg={colors.purple.medium} borderRadius="full" />
                </Progress.Track>
              </Progress.Root>
            </Box>
          </VStack>

          <VStack
            align="stretch"
            gap={3}
            flexShrink={0}
            w={{ base: "full", md: "148px" }}
          >
            <Text fontSize="sm" color={theme.text.muted} whiteSpace="nowrap" textAlign="right">
              {formatDate(project.updatedAt)}
            </Text>

            <VStack align="stretch" gap={2}>
              <OutlinedActionButton
                width="100%"
                justifyContent="flex-start"
                startIcon={<ArrowRight size={16} />}
                onClick={handleOpen}
              >
                Open
              </OutlinedActionButton>
              <OutlinedActionButton
                width="100%"
                justifyContent="flex-start"
                startIcon={<Pencil size={16} />}
                onClick={onEditOpen}
              >
                Edit
              </OutlinedActionButton>
              <OutlinedActionButton
                width="100%"
                justifyContent="flex-start"
                startIcon={<Trash2 size={16} />}
                onClick={onDeleteOpen}
              >
                Delete
              </OutlinedActionButton>
            </VStack>
          </VStack>
        </HStack>
      </Box>
      <EditClipperProjectModal
        isOpen={isEditOpen}
        onClose={onEditClose}
        project={project}
        onProjectUpdated={() => {
          onEditClose();
          onUpdated();
        }}
      />

      <DeleteClipperProjectModal
        isOpen={isDeleteOpen}
        onClose={onDeleteClose}
        project={project}
        onProjectDeleted={() => {
          onDeleteClose();
          onDeleted();
        }}
      />
    </>
  );
}
