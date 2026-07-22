import { useCallback, useEffect, useState } from "react";
import { Box, HStack, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { ArchiveRestore, FlaskConical, Plus } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../../../theme";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { appToast } from "../../../shared/utils/toast.service";
import { testDataService } from "../test-data.service";
import type { TestDatasetSummary } from "../test.types";
import { CreateTestDatasetModal } from "./create-test-dataset-modal.component";
import { TestDatasetListRow } from "./test-dataset-list-row.component";

export function TestsHomeView() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const modal = useDisclosure();
  const [datasets, setDatasets] = useState<TestDatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDatasets(await testDataService.listDatasets());
    } catch (error) {
      appToast.error("Could not load test datasets", String(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const importDataset = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Open Clipper benchmark", extensions: ["ocbench"] }] });
    if (!path || Array.isArray(path)) return;
    try {
      const dataset = await testDataService.importDataset(path);
      appToast.success("Dataset imported", dataset.name);
      navigate(`/clipper/tests/${dataset.id}`);
    } catch (error) {
      appToast.error("Could not import dataset", String(error));
    }
  };

  return (
    <VStack align="stretch" gap={7}>
      <HStack justify="space-between" align="start" flexWrap="wrap" gap={4}>
        <VStack align="start" gap={2} maxW="700px">
          <SecondaryMainTitle fontSize={{ base: "2xl", md: "3xl" }} fontWeight="bold">
            Manual framing test datasets
          </SecondaryMainTitle>
          <Text color={theme.text.muted}>
            Build a durable reference corpus, annotate one or two visible targets, and compare the production tracker across output ratios.
          </Text>
        </VStack>
        <VStack align="stretch" gap={2} minW={{ base: "full", sm: "240px" }}>
          <OutlinedActionButton
            width="100%"
            justifyContent="flex-start"
            startIcon={<ArchiveRestore size={16} />}
            onClick={() => void importDataset()}
          >
            Import .ocbench
          </OutlinedActionButton>
          <OutlinedActionButton
            width="100%"
            justifyContent="flex-start"
            startIcon={<Plus size={16} />}
            onClick={modal.onOpen}
          >
            New dataset
          </OutlinedActionButton>
        </VStack>
      </HStack>

      {loading ? <AppLoader /> : datasets.length === 0 ? (
        <Box p={10} border="1px dashed" borderColor={theme.dashboard.border} borderRadius="2xl" textAlign="center">
          <FlaskConical size={34} style={{ margin: "0 auto 12px" }} />
          <Text fontWeight="semibold">No manual test datasets yet</Text>
          <Text color={theme.text.muted} fontSize="sm" mt={1}>Create one, then add independently stored clips from your source videos.</Text>
        </Box>
      ) : (
        <VStack align="stretch" gap={3}>
          {datasets.map((dataset) => (
            <TestDatasetListRow
              key={dataset.id}
              dataset={dataset}
              onUpdated={() => void load()}
            />
          ))}
        </VStack>
      )}

      <CreateTestDatasetModal
        open={modal.open}
        onClose={modal.onClose}
        onCreated={(id) => navigate(`/clipper/tests/${id}`)}
      />
    </VStack>
  );
}
