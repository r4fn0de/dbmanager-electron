import type { AiRendererApi } from "@/shared/ai/streaming-contracts";

declare global {
  interface Window {
    ai: AiRendererApi;
  }
}

export {};
