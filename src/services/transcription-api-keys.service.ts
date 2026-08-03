import {
  localRecordDelete,
  localRecordGet,
  localRecordPut,
} from "../shared/persistence/local-database.util";

export type CloudTranscriptionProvider = "groq" | "openrouter";

const NAMESPACE = "transcription-api-keys";

interface StoredTranscriptionApiKey {
  apiKey: string;
  updatedAt: string;
}

export interface TranscriptionApiKeyPublicView {
  provider: CloudTranscriptionProvider;
  isKeyConfigured: boolean;
  keyPreview: string | null;
}

const PROVIDER_MODELS_URL: Record<CloudTranscriptionProvider, string> = {
  groq: "https://api.groq.com/openai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models",
};

function keyPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

function toPublicView(
  provider: CloudTranscriptionProvider,
  stored: StoredTranscriptionApiKey | null,
): TranscriptionApiKeyPublicView {
  const apiKey = stored?.apiKey?.trim() ?? "";
  return {
    provider,
    isKeyConfigured: apiKey.length > 0,
    keyPreview: apiKey ? keyPreview(apiKey) : null,
  };
}

export const transcriptionApiKeysService = {
  async getPublic(
    provider: CloudTranscriptionProvider,
  ): Promise<TranscriptionApiKeyPublicView> {
    const stored = await localRecordGet<StoredTranscriptionApiKey>(
      NAMESPACE,
      provider,
    );
    return toPublicView(provider, stored);
  },

  async get(provider: CloudTranscriptionProvider): Promise<string | null> {
    const stored = await localRecordGet<StoredTranscriptionApiKey>(
      NAMESPACE,
      provider,
    );
    const apiKey = stored?.apiKey?.trim();
    return apiKey || null;
  },

  async set(
    provider: CloudTranscriptionProvider,
    apiKey: string,
  ): Promise<TranscriptionApiKeyPublicView> {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      throw new Error("API key cannot be empty.");
    }
    const payload: StoredTranscriptionApiKey = {
      apiKey: trimmed,
      updatedAt: new Date().toISOString(),
    };
    await localRecordPut(NAMESPACE, provider, null, payload);
    return toPublicView(provider, payload);
  },

  async clear(provider: CloudTranscriptionProvider): Promise<void> {
    await localRecordDelete(NAMESPACE, provider);
  },

  async validate(
    provider: CloudTranscriptionProvider,
    apiKey: string,
  ): Promise<boolean> {
    const trimmed = apiKey.trim();
    if (!trimmed) return false;
    const response = await fetch(PROVIDER_MODELS_URL[provider], {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    return response.ok;
  },
};
