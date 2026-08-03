import React from "react";
import { transcriptionApiKeysService } from "../../../services/transcription-api-keys.service";
import type { CloudTranscriptionProvider } from "../../../services/transcription-api-keys.service";
import type { TranscriptionApiKeyPublicView } from "../../../services/transcription-api-keys.service";

export function useCloudTranscriptionProvider(provider: CloudTranscriptionProvider) {
  const [publicView, setPublicView] = React.useState<TranscriptionApiKeyPublicView>({
    provider,
    isKeyConfigured: false,
    keyPreview: null,
  });
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const view = await transcriptionApiKeysService.getPublic(provider);
    setPublicView(view);
    return view;
  }, [provider]);

  React.useEffect(() => {
    void refresh().catch(() => {
      setError("Could not load API key status.");
    });
  }, [refresh]);

  const handleSave = React.useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const view = await transcriptionApiKeysService.set(provider, apiKeyInput);
      setPublicView(view);
      setApiKeyInput("");
      setSuccess("API key saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save API key.",
      );
    } finally {
      setSaving(false);
    }
  }, [apiKeyInput, provider]);

  const handleTest = React.useCallback(async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const key =
        apiKeyInput.trim() ||
        (await transcriptionApiKeysService.get(provider));
      if (!key) {
        throw new Error("Enter an API key before testing.");
      }
      const valid = await transcriptionApiKeysService.validate(provider, key);
      if (!valid) {
        throw new Error("API key validation failed.");
      }
      setSuccess("API key is valid.");
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : "API key test failed.",
      );
    } finally {
      setTesting(false);
    }
  }, [apiKeyInput, provider]);

  const handleClear = React.useCallback(async () => {
    setError(null);
    setSuccess(null);
    await transcriptionApiKeysService.clear(provider);
    setApiKeyInput("");
    await refresh();
  }, [provider, refresh]);

  return {
    publicView,
    apiKeyInput,
    setApiKeyInput,
    saving,
    testing,
    error,
    success,
    handleSave,
    handleTest,
    handleClear,
    refresh,
  };
}
