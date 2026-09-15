import { useCallback, useEffect, useState } from "react";
import {
  transcriptionApiKeysService,
  type CloudTranscriptionProvider,
  type TranscriptionApiKeyPublicView,
} from "../../../services/transcription-api-keys.service";
import {
  loadClipperSettings,
  saveTranscriptionEngine,
} from "../settings/settings-storage.util";
import type { ClipperTranscriptionEngine } from "../settings/settings.util";
import { useParakeetModelDownload } from "./use-parakeet-model-download.hook";
import { useVocalsIsolateModelStatus } from "./use-vocals-isolate-model-status.hook";
import { useWhisperModelStatus } from "./use-whisper-model-status.hook";

/** Fallback order when the selected engine is no longer available. */
const ENGINE_PRIORITY: ClipperTranscriptionEngine[] = ["parakeet", "whisper", "groq", "openrouter"];

function emptyKeyView(provider: CloudTranscriptionProvider): TranscriptionApiKeyPublicView {
  return { provider, isKeyConfigured: false, keyPreview: null };
}

/** A model hook has answered once, with a status or an error. */
function statusKnown(hook: { modelStatus: unknown; error: string | null }): boolean {
  return hook.modelStatus !== null || hook.error !== null;
}

export function useClipperSetupReadiness() {
  const vocals = useVocalsIsolateModelStatus();
  const parakeet = useParakeetModelDownload();
  const whisper = useWhisperModelStatus();
  const [groq, setGroq] = useState(() => emptyKeyView("groq"));
  const [openrouter, setOpenrouter] = useState(() => emptyKeyView("openrouter"));
  const [keysLoaded, setKeysLoaded] = useState(false);

  const refreshApiKeys = useCallback(async () => {
    try {
      const [nextGroq, nextOpenrouter] = await Promise.all([
        transcriptionApiKeysService.getPublic("groq"),
        transcriptionApiKeysService.getPublic("openrouter"),
      ]);
      setGroq(nextGroq);
      setOpenrouter(nextOpenrouter);
    } catch {
      setGroq(emptyKeyView("groq"));
      setOpenrouter(emptyKeyView("openrouter"));
    } finally {
      setKeysLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshApiKeys();
  }, [refreshApiKeys]);

  const refreshVocals = vocals.refreshStatus;
  const refreshParakeet = parakeet.refreshStatus;
  const refreshWhisper = whisper.refreshStatus;
  /** Re-reads everything; models and keys can change from the Settings tab. */
  const refresh = useCallback(async () => {
    await Promise.all([refreshVocals(), refreshParakeet(), refreshWhisper(), refreshApiKeys()]);
  }, [refreshVocals, refreshParakeet, refreshWhisper, refreshApiKeys]);

  const parakeetInstalled = Boolean(parakeet.modelStatus?.installed);
  const whisperInstalled = whisper.installed;
  const groqConfigured = groq.isKeyConfigured;
  const openrouterConfigured = openrouter.isKeyConfigured;

  const loaded = keysLoaded && statusKnown(vocals) && statusKnown(parakeet) && statusKnown(whisper);
  const vocalsReady = vocals.installed;
  const asrReady = parakeetInstalled || whisperInstalled || groqConfigured || openrouterConfigured;
  const setupReady = loaded && vocalsReady && asrReady;

  useEffect(() => {
    if (!loaded) return;
    const available: Record<ClipperTranscriptionEngine, boolean> = {
      parakeet: parakeetInstalled,
      whisper: whisperInstalled,
      groq: groqConfigured,
      openrouter: openrouterConfigured,
    };
    if (available[loadClipperSettings().transcription.engine]) return;
    const fallback = ENGINE_PRIORITY.find((engine) => available[engine]);
    if (fallback) saveTranscriptionEngine(fallback);
  }, [loaded, parakeetInstalled, whisperInstalled, groqConfigured, openrouterConfigured]);

  const downloadParakeet = parakeet.handleDownload;
  const downloadParakeetAndSelect = useCallback(async () => {
    const status = await downloadParakeet();
    if (status?.installed) saveTranscriptionEngine("parakeet");
  }, [downloadParakeet]);

  const downloadWhisper = whisper.handleDownload;
  const downloadWhisperAndSelect = useCallback(async () => {
    const status = await downloadWhisper();
    if (status?.installed) saveTranscriptionEngine("whisper");
  }, [downloadWhisper]);

  const saveApiKeyAndSelect = useCallback(
    async (provider: CloudTranscriptionProvider, apiKey: string) => {
      const view = await transcriptionApiKeysService.set(provider, apiKey);
      saveTranscriptionEngine(provider);
      if (provider === "groq") setGroq(view);
      else setOpenrouter(view);
      return view;
    },
    [],
  );

  return {
    loaded,
    vocalsReady,
    asrReady,
    setupReady,
    vocals,
    parakeet,
    whisper,
    groq,
    openrouter,
    refresh,
    downloadParakeetAndSelect,
    downloadWhisperAndSelect,
    saveApiKeyAndSelect,
  };
}

export type ClipperSetupReadiness = ReturnType<typeof useClipperSetupReadiness>;
