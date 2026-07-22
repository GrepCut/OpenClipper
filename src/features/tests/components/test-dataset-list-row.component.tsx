import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Box, HStack, Progress, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { ArrowRight, Pencil } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { colors, useTheme } from "../../../theme";
import type { TestDatasetSummary } from "../test.types";
import { EditTestDatasetModal } from "./edit-test-dataset-modal.component";

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function datasetStatusLabel(dataset: TestDatasetSummary): string {
  if (dataset.clipCount === 0) return "Empty";
  if (dataset.annotatedClipCount === 0) return "Needs annotation";
  if (dataset.annotatedClipCount < dataset.clipCount) return "Annotating";
  return "Ready to benchmark";
}

interface TestDatasetListRowProps {
  dataset: TestDatasetSummary;
  onUpdated: () => void;
}

export function TestDatasetListRow({
  dataset,
  onUpdated,
}: TestDatasetListRowProps) {
  const navigate = useNavigate();
  const { theme, mode } = useTheme();
  const editModal = useDisclosure();
  const rowBg = mode === "dark" ? theme.background.card : "gray.50";
  const progressPercent =
    dataset.clipCount > 0 ? (dataset.annotatedClipCount / dataset.clipCount) * 100 : 0;

  const handleOpen = useCallback(() => {
    navigate(`/clipper/tests/${dataset.id}`);
  }, [dataset.id, navigate]);

  return (
    <>
      <Box bg={rowBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
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
              {dataset.name}
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
                {datasetStatusLabel(dataset)}
              </Box>
              <Text fontSize="xs" color={theme.text.muted}>
                {dataset.annotatedClipCount}/{dataset.clipCount} annotated · {formatDuration(dataset.totalDuration)}
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
              {formatDate(dataset.updatedAt)}
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
                onClick={editModal.onOpen}
              >
                Edit
              </OutlinedActionButton>
            </VStack>
          </VStack>
        </HStack>
      </Box>

      <EditTestDatasetModal
        open={editModal.open}
        dataset={dataset}
        onClose={editModal.onClose}
        onUpdated={() => {
          editModal.onClose();
          onUpdated();
        }}
      />
    </>
  );
}
