import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Renderer } from "../ui/renderer";
import type { TokenSpeedEngine } from "./engine";
import type { MessageHandler, MessageUpdatePayload } from "./message-handler";

/** Which endpoint a stream is heading to, for config and calibration. */
export interface StreamTarget {
  providerId?: string;
  modelId?: string;
}

/**
 * Handles stream-start events (text_start, thinking_start, toolcall_start).
 *
 * Applies the target's provider overrides, stops the TTFT timer, and starts the
 * engine. The model id travels with the provider id because learned token ratios
 * are keyed on both: one LiteLLM endpoint can front several tokenizers.
 */
export class StreamStartHandler implements MessageHandler {
  readonly types = ["text_start", "thinking_start", "toolcall_start"];

  constructor(
    private readonly engine: TokenSpeedEngine,
    private readonly getTarget: (ctx: ExtensionContext) => StreamTarget,
  ) {}

  handle(_event: MessageUpdatePayload, ctx: ExtensionContext): void {
    const { providerId, modelId } = this.getTarget(ctx);
    this.engine.applyProvider(providerId, modelId);
    this.engine.stopTTFT();
    this.engine.start();
  }
}

/**
 * Handles content/delta events (text_delta, thinking_delta).
 *
 * Records the token delta and triggers a renderer update.
 */
export class DeltaHandler implements MessageHandler {
  readonly types = ["text_delta", "thinking_delta"];

  constructor(
    private readonly engine: TokenSpeedEngine,
    private readonly renderer: Renderer,
  ) {}

  handle(event: MessageUpdatePayload, ctx: ExtensionContext): void {
    this.engine.recordDelta(
      event.assistantMessageEvent.delta ?? "",
      event.assistantMessageEvent.partial?.usage?.output,
    );
    this.renderer.update(ctx);
  }
}

/**
 * Handles tool call delta events.
 *
 * Counts every assistant tool-call delta — the model generates all tool
 * arguments during decoding, so they all consume output tokens.
 */
export class ToolcallDeltaHandler implements MessageHandler {
  readonly types = ["toolcall_delta"];

  constructor(
    private readonly engine: TokenSpeedEngine,
    private readonly renderer: Renderer,
  ) {}

  handle(event: MessageUpdatePayload, ctx: ExtensionContext): void {
    const toolCall =
      event.assistantMessageEvent.partial?.content?.[
        event.assistantMessageEvent.contentIndex ?? 0
      ];
    if (toolCall?.type !== "toolCall") return;

    this.engine.recordDelta(
      event.assistantMessageEvent.delta ?? "",
      event.assistantMessageEvent.partial?.usage?.output,
    );
    this.renderer.update(ctx);
  }
}

/**
 * Handles tool call end events.
 *
 * Pauses the engine to exclude tool-execution time from TPS averages.
 */
export class ToolcallEndHandler implements MessageHandler {
  readonly types = ["toolcall_end"];

  constructor(private readonly engine: TokenSpeedEngine) {}

  handle(event: MessageUpdatePayload): void {
    const toolCall =
      event.assistantMessageEvent.partial?.content?.[
        event.assistantMessageEvent.contentIndex ?? 0
      ];
    if (toolCall?.type !== "toolCall") return;

    this.engine.pause();
  }
}
