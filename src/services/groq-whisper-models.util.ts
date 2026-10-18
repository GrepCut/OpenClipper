export const GROQ_WHISPER_MODELS = [
  {
    id: "whisper-large-v3-turbo",
    label: "Large v3 Turbo",
    hint: "Fastest and cheapest. Good for most clips.",
  },
  {
    id: "whisper-large-v3",
    label: "Large v3",
    hint: "Best accuracy, slower. Pick it when the transcript has mistakes.",
  },
] as const;

export type GroqWhisperModel = (typeof GROQ_WHISPER_MODELS)[number]["id"];

export const DEFAULT_GROQ_WHISPER_MODEL: GroqWhisperModel = "whisper-large-v3-turbo";

export function isGroqWhisperModel(value: unknown): value is GroqWhisperModel {
  return GROQ_WHISPER_MODELS.some((model) => model.id === value);
}
