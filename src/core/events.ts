import type {
  AgentEndEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SettingsProvider } from "../config/types";
import { Renderer } from "../ui/renderer";
import { TokenSpeedEngine } from "./engine";
import type { MessageUpdatePayload } from "./message-handler";
import { MessageHandlerRegistry } from "./message-handler";
import {
  DeltaHandler,
  StreamStartHandler,
  ToolcallDeltaHandler,
  ToolcallEndHandler,
} from "./message-handlers";

/**
 * Manages all Pi event subscriptions for the token-speed extension.
 */
export class EventManager {
  private readonly registry: MessageHandlerRegistry;

  constructor(
    private readonly engine: TokenSpeedEngine,
    private readonly renderer: Renderer,
    private readonly settings: SettingsProvider,
  ) {
    this.registry = new MessageHandlerRegistry();
    this.registry.register(
      new StreamStartHandler(engine, (ctx) => ({
        providerId: ctx.model?.provider,
        modelId: ctx.model?.id,
      })),
    );
    this.registry.register(new DeltaHandler(engine, renderer));
    this.registry.register(new ToolcallDeltaHandler(engine, renderer));
    this.registry.register(new ToolcallEndHandler(engine));
  }

  /**
   * Initializes the engine and renderer for a new session.
   *
   * @param ctx The Pi extension context.
   */
  async handleSessionStart(ctx: ExtensionContext): Promise<void> {
    await this.settings.initialize();
    const errors = this.settings.getErrors();

    if (errors.length > 0) {
      const message = ["[pi-token-speed]", ...errors].join("\n");
      ctx.ui.notify(message, "warning");
    }

    this.engine.initialize();
    this.engine.applyProvider(ctx.model?.provider, ctx.model?.id);
    this.renderer.initialize(ctx);
    this.renderer.resetThrottle();
  }

  /**
   * Stops the engine when the session shuts down.
   */
  handleSessionShutdown(): void {
    this.engine.stop();
  }

  /**
   * Starts TTFT measurement for user messages, and marks the boundary for
   * assistant messages.
   *
   * The boundary matters because providers count output tokens cumulatively per
   * assistant message: a turn that calls a tool produces a second assistant
   * message whose count starts over, and without knowing where one message ends
   * and the next begins, that restart reads as the stream stalling at zero.
   *
   * @param event The message_start event payload.
   */
  handleMessageStart(event: { message?: { role?: string } }): void {
    if (event.message?.role === "user") {
      this.engine.startTTFT();
      return;
    }
    if (event.message?.role === "assistant") {
      this.engine.beginMessage();
    }
  }

  /**
   * Routes message update events through the handler registry.
   *
   * @param event The message_update event payload.
   * @param ctx The Pi extension context.
   */
  handleMessageUpdate(
    event: MessageUpdatePayload,
    ctx: ExtensionContext,
  ): void {
    this.registry.handle(event, ctx);
  }

  /**
   * Reconciles the total token count, stops streaming, and updates the renderer.
   *
   * @param event The message_end event payload.
   * @param ctx The Pi extension context.
   */
  handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): void {
    this.engine.stop();

    // Assistant messages only. `toolResult` messages can carry a usage block of
    // their own — the accounting of a nested agent run — and this stream never
    // counted those tokens. Folding them in would inflate the authoritative total
    // relative to what was observed, and a correction based on that would teach
    // the counter that this model produces more tokens per delta than it does.
    const outputTokens = event.messages.reduce(
      (acc, curr) =>
        curr.role === "assistant" ? acc + curr.usage.output : acc,
      0,
    );

    this.engine.reconcileTotal(outputTokens);
    this.renderer.resetThrottle();
    this.renderer.update(ctx);
  }
}
