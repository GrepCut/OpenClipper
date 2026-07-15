import { apiClient } from "../../../shared/utils/apiClient";
import {
  localRecordDelete,
  localRecordGet,
  localRecordPut,
} from "../../../shared/persistence/local-database";
import type { ClipSourceMode } from "./project-metadata";

export type { ClipSourceMode };

export type ClipperAiClipPickerModel =
  "deepseek-v4-flash" | "deepseek-v4-pro" | "deepseek-v4-pro-thinking";

export interface ClipperAiWordCue {
  text: string;
  start: number;
  end: number;
}

export interface ClipperAiClipSegmentRange {
  wordStartIdx: number;
  wordEndIdx: number;
}

export interface ClipperAiClipRange {
  segments: ClipperAiClipSegmentRange[];
  label?: string;
}

export interface ClipperAiClipSegment {
  wordStartIdx: number;
  wordEndIdx: number;
  startSec: number;
  endSec: number;
}

export interface ClipperAiClipPick {
  index: number;
  segments: ClipperAiClipSegment[];
  startSec: number;
  endSec: number;
  durationSec: number;
  label?: string;
}

export interface ClipperAiChatMessage {
  id: string;
  projectId: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  clipsSnapshot: { clips: ClipperAiClipPick[] } | null;
  createdAt: string;
}

export interface SendClipperAiChatPayload {
  message: string;
  model: ClipperAiClipPickerModel;
  preset?: string;
  words: ClipperAiWordCue[];
  currentClips?: ClipperAiClipRange[];
}

export const clipperAiClipService = {
  getChatHistory: async (
    projectId: string,
  ): Promise<ClipperAiChatMessage[]> => {
    return (
      (await localRecordGet<ClipperAiChatMessage[]>(
        "clipper-ai-chat",
        projectId,
      )) ?? []
    );
  },

  getAiClips: async (projectId: string): Promise<ClipperAiClipPick[]> => {
    return (
      (await localRecordGet<ClipperAiClipPick[]>(
        "clipper-ai-clips",
        projectId,
      )) ?? []
    );
  },

  clearChatHistory: async (projectId: string): Promise<void> => {
    await Promise.all([
      localRecordDelete("clipper-ai-chat", projectId),
      localRecordDelete("clipper-ai-clips", projectId),
    ]);
  },

  sendChatMessage: async (
    projectId: string,
    payload: SendClipperAiChatPayload,
  ): Promise<{
    userMessage: ClipperAiChatMessage;
    assistantMessage: ClipperAiChatMessage;
    clips: ClipperAiClipPick[];
  }> => {
    return new Promise((resolve, reject) => {
      let userMessage: ClipperAiChatMessage | undefined;
      void clipperAiClipService
        .sendChatMessageStream(projectId, payload, {
          onUserMessage: (message) => {
            userMessage = message;
          },
          onDone: ({ assistantMessage, clips }) => {
            if (!userMessage)
              return reject(new Error("AI chat user message was not created."));
            resolve({ userMessage, assistantMessage, clips });
          },
          onError: reject,
        })
        .catch(reject);
    });
  },

  sendChatMessageStream: async (
    projectId: string,
    payload: SendClipperAiChatPayload,
    events: ClipperAiChatStreamEvents,
    signal?: AbortSignal,
  ): Promise<void> => {
    const baseURL = apiClient.defaults.baseURL ?? "";
    const authHeader = apiClient.defaults.headers.common["Authorization"];

    const history = await clipperAiClipService.getChatHistory(projectId);
    const now = new Date().toISOString();
    const userMessage: ClipperAiChatMessage = {
      id: crypto.randomUUID(),
      projectId,
      role: "user",
      content: payload.message.trim(),
      model: payload.model,
      clipsSnapshot: null,
      createdAt: now,
    };
    const historyWithUser = [...history, userMessage];
    await localRecordPut(
      "clipper-ai-chat",
      projectId,
      projectId,
      historyWithUser,
    );
    events.onUserMessage?.(userMessage);

    const response = await fetch(`${baseURL}/clipper/ai-clips/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(authHeader ? { Authorization: String(authHeader) } : {}),
      },
      body: JSON.stringify({
        ...payload,
        requestId: crypto.randomUUID(),
        clientProjectId: projectId,
        history: history
          .slice(-20)
          .map(({ role, content }) => ({ role, content })),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `AI clip chat stream failed (status ${response.status}).`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6)) as ClipperAiChatStreamEvent;
        if (event.type === "done") {
          await Promise.all([
            localRecordPut("clipper-ai-chat", projectId, projectId, [
              ...historyWithUser,
              event.assistantMessage,
            ]),
            localRecordPut(
              "clipper-ai-clips",
              projectId,
              projectId,
              event.clips,
            ),
          ]);
        }
        dispatchClipperAiChatStreamEvent(event, events);
      }
    }
  },
};

export interface ClipperAiChatStreamEvents {
  onUserMessage?: (message: ClipperAiChatMessage) => void;
  onThinkingDelta?: (delta: string) => void;
  onProgress?: (chars: number) => void;
  onDone?: (result: {
    assistantMessage: ClipperAiChatMessage;
    clips: ClipperAiClipPick[];
  }) => void;
  onError?: (message: string) => void;
}

type ClipperAiChatStreamEvent =
  | { type: "user_message"; message: ClipperAiChatMessage }
  | { type: "thinking_delta"; content: string }
  | { type: "progress"; chars: number }
  | {
      type: "done";
      assistantMessage: ClipperAiChatMessage;
      clips: ClipperAiClipPick[];
    }
  | { type: "error"; message: string };

function dispatchClipperAiChatStreamEvent(
  event: ClipperAiChatStreamEvent,
  events: ClipperAiChatStreamEvents,
): void {
  switch (event.type) {
    case "user_message":
      events.onUserMessage?.(event.message);
      break;
    case "thinking_delta":
      events.onThinkingDelta?.(event.content);
      break;
    case "progress":
      events.onProgress?.(event.chars);
      break;
    case "done":
      events.onDone?.({
        assistantMessage: event.assistantMessage,
        clips: event.clips,
      });
      break;
    case "error":
      events.onError?.(event.message);
      break;
  }
}
