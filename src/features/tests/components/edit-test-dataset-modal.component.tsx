import { useEffect, useState } from "react";
import { Field, Input, Textarea, VStack } from "@chakra-ui/react";
import { StyledModal, StyledModalFooter } from "../../../shared/components/styled-modal.component";
import { appToast } from "../../../shared/utils/toast.service";
import { testDataService } from "../test-data.service";
import type { TestDatasetSummary } from "../test.types";

export function EditTestDatasetModal(props: {
  open: boolean;
  dataset: TestDatasetSummary | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!props.open || !props.dataset) return;
    setName(props.dataset.name);
    setDescription(props.dataset.description || "");
  }, [props.open, props.dataset]);

  const submit = async () => {
    if (!props.dataset || !name.trim() || loading) return;
    setLoading(true);
    try {
      await testDataService.updateDataset(props.dataset.id, name, description);
      appToast.success("Test dataset updated", name.trim());
      props.onClose();
      props.onUpdated();
    } catch (error) {
      appToast.error("Could not update dataset", String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <StyledModal
      isOpen={props.open}
      onClose={props.onClose}
      title="Edit test dataset"
      size="lg"
      isLoading={loading}
      onFormSubmit={() => void submit()}
      footer={
        <StyledModalFooter
          onCancel={props.onClose}
          onSubmit={() => void submit()}
          submitText="Save changes"
          isLoading={loading}
          submitDisabled={!name.trim()}
        />
      }
    >
      <VStack align="stretch" gap={4}>
        <Field.Root required>
          <Field.Label>Name</Field.Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} />
        </Field.Root>
        <Field.Root>
          <Field.Label>Description</Field.Label>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </Field.Root>
      </VStack>
    </StyledModal>
  );
}
