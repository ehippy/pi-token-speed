import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AgentEndEvent,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { MAX_TOKENS_PER_UNIT } from "../src/core/token-calibration";
import { STATUS_KEY } from "../src/config/constants";
import type { TokenSpeedConfig } from "../src/config/types";
import { EventManager } from "../src/core/events";
import { TokenSpeedEngine } from "../src/core/engine";
import { Renderer } from "../src/ui/renderer";
import { makeSettingsMock } from "./mocks/settings";

/** Engine with time under test control, so TTFT and pauses are deterministic. */
class ClockedEngine extends TokenSpeedEngine {
  clock = 1_000;
  protected override now() {
    return this.clock;
  }
}

const config: TokenSpeedConfig = {
  ...makeSettingsMock().getDefaultConfig(),
  countStrategy: "auto",
};

const settings = makeSettingsMock(config);

const ctx = {
  model: { provider: "litellm", id: "qwen-flash-bebop" },
  ui: {
    setStatus: vi.fn(),
    notify: vi.fn(),
    theme: { fg: (_c: string, text: string) => text },
  },
} as unknown as ExtensionContext;

const update = (type: string, extra: Record<string, unknown> = {}) => ({
  assistantMessageEvent: { type, delta: "hello there", ...extra },
});

describe("EventManager wiring", () => {
  let engine: ClockedEngine;
  let renderer: Renderer;
  let events: EventManager;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ClockedEngine(settings);
    engine.initialize();
    renderer = new Renderer(engine, settings);
    events = new EventManager(engine, renderer, settings);
  });

  describe("message_start", () => {
    it("starts TTFT for a user message", () => {
      events.handleMessageStart({ message: { role: "user" } });
      engine.clock += 250;
      events.handleMessageUpdate(update("text_start"), ctx);

      expect(engine.ttft).toBe(250);
    });

    it("marks a per-message boundary for an assistant message", () => {
      const begin = vi.spyOn(engine, "beginMessage");
      events.handleMessageStart({ message: { role: "assistant" } });
      expect(begin).toHaveBeenCalledOnce();
    });

    it("ignores tool results", () => {
      const begin = vi.spyOn(engine, "beginMessage");
      const ttft = vi.spyOn(engine, "startTTFT");
      events.handleMessageStart({ message: { role: "toolResult" } });
      expect(begin).not.toHaveBeenCalled();
      expect(ttft).not.toHaveBeenCalled();
    });
  });

  describe("stream start", () => {
    it("applies the provider and model of the target", () => {
      const apply = vi.spyOn(engine, "applyProvider");
      events.handleMessageUpdate(update("text_start"), ctx);

      expect(apply).toHaveBeenCalledWith("litellm", "qwen-flash-bebop");
      expect(engine.isStreaming).toBe(true);
    });

    it("starts the stream once, whatever content block opens", () => {
      events.handleMessageUpdate(update("text_start"), ctx);
      const tokens = engine.tokenCount;
      events.handleMessageUpdate(update("thinking_start"), ctx);
      events.handleMessageUpdate(update("toolcall_start"), ctx);

      // start() is a no-op mid-stream, so nothing was reset
      expect(engine.tokenCount).toBe(tokens);
    });
  });

  describe("deltas", () => {
    it("counts text and thinking deltas and repaints the status bar", () => {
      events.handleMessageUpdate(update("text_start"), ctx);
      events.handleMessageUpdate(update("text_delta"), ctx);
      events.handleMessageUpdate(update("thinking_delta"), ctx);

      // "hello there" scores two units per delta
      expect(engine.tokenCount).toBe(4);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith(
        STATUS_KEY,
        expect.any(String),
      );
    });

    it("passes the partial's reported usage through", () => {
      const adaptive = new ClockedEngine(
        makeSettingsMock({ ...config, useProviderTokens: true }),
      );
      adaptive.initialize();
      const wired = new EventManager(
        adaptive,
        new Renderer(adaptive, settings),
        settings,
      );
      wired.handleMessageUpdate(update("text_start"), ctx);
      wired.handleMessageUpdate(
        update("text_delta", { partial: { usage: { output: 42 } } }),
        ctx,
      );

      expect(adaptive.tokenCount).toBe(42);
    });
  });

  describe("agent_end", () => {
    const message = (role: string, output: number) =>
      ({
        role,
        usage: { output },
      }) as unknown as AgentEndEvent["messages"][number];

    const end = (messages: AgentEndEvent["messages"]) =>
      events.handleAgentEnd(
        { messages, toolResults: [] } as unknown as AgentEndEvent,
        ctx,
      );

    it("reconciles against assistant output only", () => {
      events.handleMessageUpdate(update("text_start"), ctx);
      events.handleMessageUpdate(update("text_delta"), ctx); // 2 units

      engine.clock += 1000;
      end([message("assistant", 300), message("assistant", 200)]);

      expect(engine.tokenCount).toBe(500);
      expect(engine.isStreaming).toBe(false);
    });

    it("ignores usage reported by nested tool runs", () => {
      events.handleMessageUpdate(update("text_start"), ctx);
      events.handleMessageUpdate(update("text_delta"), ctx); // 2 units

      engine.clock += 1000;
      // A nested agent's tokens were never part of this stream: folding them in
      // would teach the counter that this model emits more per delta than it does.
      end([message("assistant", 300), message("toolResult", 999)]);

      expect(engine.tokenCount).toBe(300);
      // 300 tokens over 2 units is an implausible ratio, so it is clamped rather
      // than believed: one odd measurement must not skew the rest of the session.
      expect(engine.tokensPerUnit).toBe(MAX_TOKENS_PER_UNIT);
    });

    it("leaves the count alone when the provider reports nothing", () => {
      events.handleMessageUpdate(update("text_start"), ctx);
      events.handleMessageUpdate(update("text_delta"), ctx); // 2 units

      end([message("assistant", 0)]);

      expect(engine.tokenCount).toBe(2);
    });

    it("renders past the throttle so the final number is shown", () => {
      const throttled = makeSettingsMock({ ...config, updateInterval: 60_000 });
      const finalEngine = new ClockedEngine(throttled);
      finalEngine.initialize();
      const finalRenderer = new Renderer(finalEngine, throttled);
      const wired = new EventManager(finalEngine, finalRenderer, throttled);

      wired.handleMessageUpdate(update("text_start"), ctx);
      const before = vi.mocked(ctx.ui.setStatus).mock.calls.length;
      wired.handleAgentEnd(
        { messages: [message("assistant", 10)] } as unknown as AgentEndEvent,
        ctx,
      );

      expect(vi.mocked(ctx.ui.setStatus).mock.calls.length).toBeGreaterThan(
        before,
      );
    });
  });
});
