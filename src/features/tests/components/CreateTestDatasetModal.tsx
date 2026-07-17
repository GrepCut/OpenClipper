import { useEffect, useState } from "react";
import { Field, Input, Textarea, VStack } from "@chakra-ui/react";
import { StyledModal, StyledModalFooter } from "../../../shared/components/StyledModal";
import { appToast } from "../../../shared/utils/toast.service";
import { testDataService } from "../test-data.service";

export function CreateTestDatasetModal(props: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!props.open) {
      setName("");
      setDescription("");
    }
  }, [props.open]);

  const submit = async () => {
    if (!name.trim() || loading) return;
    setLoading(true);
    try {
      const dataset = await testDataService.createDataset(name, description);
      appToast.success("Test dataset created", dataset.name);
      props.onClose();
      props.onCreated(dataset.id);
    } catch (error) {
      appToast.error("Could not create dataset", String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <StyledModal
      isOpen={props.open}
      onClose={props.onClose}
      title="New test dataset"
      size="lg"
      isLoading={loading}
      onFormSubmit={() => void submit()}
      footer={
        <StyledModalFooter
          onCancel={props.onClose}
          onSubmit={() => void submit()}
          submitText="Create dataset"
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
