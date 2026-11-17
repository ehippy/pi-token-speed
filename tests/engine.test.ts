import { beforeEach, describe, expect, it, vi } from "vitest";

import { TokenSpeedEngine } from "../src/core/engine";
import { makeSettingsMock } from "./mocks/settings";

// ── Testable subclass with mocked time ──────────────────────────────────────

class TimeMockedEngine extends TokenSpeedEngine {
  constructor(
    settings: ReturnType<typeof makeSettingsMock>,
    private mockTime: number,
  ) {
    super(settings);
  }
  protected override now(): number {
    return this.mockTime;
  }
  /** Advance the mocked clock by `ms` milliseconds. */
  tick(ms: number): void {
    this.mockTime += ms;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TokenSpeedEngine", () => {
  let settings: ReturnType<typeof makeSettingsMock>;
  let engine: InstanceType<typeof TokenSpeedEngine>;

  beforeEach(() => {
    settings = makeSettingsMock();
    engine = new TokenSpeedEngine(settings);
    engine.initialize();
    engine.start();
  });

  const deltas = (n: number) => {
    for (let i = 0; i < n; i++) engine.recordDelta("x");
  };

  // ── initialization ─────────────────────────────────────────────────────

  describe("initialization", () => {
    it("is not streaming before start", () => {
      const fresh = new TokenSpeedEngine(settings);
      fresh.initialize();
      expect(fresh.isStreaming).toBe(false);
    });

    it("ignores deltas when not streaming", () => {
      const fresh = new TokenSpeedEngine(settings);
      fresh.initialize();
      fresh.recordDelta("hello");
      expect(fresh.tokenCount).toBe(0);
    });

    it("is a no-op while already streaming", () => {
      deltas(5);
      engine.start(); // must not reset while streaming
      expect(engine.tokenCount).toBe(5);
      expect(engine.isStreaming).toBe(true);
    });

    it("resets counters when restarted after stop", () => {
      deltas(5);
      engine.stop();
      engine.start();
      expect(engine.tokenCount).toBe(0);
      expect(engine.isStreaming).toBe(true);
    });
  });

  // ── direct counting ───────────────────────────────────────────────────

  describe("direct counting", () => {
    it("counts one token per delta", () => {
      deltas(10);
      expect(engine.tokenCount).toBe(10);
    });

    it("counts every delta as exactly one token regardless of content", () => {
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({ countStrategy: "direct" }),
        1000,
      );
      testEngine.initialize();
      testEngine.start();

      testEngine.recordDelta("");
      testEngine.recordDelta("a very long delta with many words");
      expect(testEngine.tokenCount).toBe(2);
    });
  });

  // ── estimate counting ─────────────────────────────────────────────────

  describe("estimate counting", () => {
    it("estimates tokens from word boundaries and punctuation", () => {
      const est = new TimeMockedEngine(settings, 1000);
      est.initialize();
      est.start();
      (est as unknown as { _countStrategy: string })._countStrategy =
        "estimate";
      est.recordDelta("hello world"); // 2 words
      est.recordDelta(" hi!"); // 1 word + 1 punctuation
      expect(est.tokenCount).toBe(4);
    });

    it("counts nothing for empty deltas", () => {
      const est = new TimeMockedEngine(settings, 1000);
      est.initialize();
      est.start();
      (est as unknown as { _countStrategy: string })._countStrategy =
        "estimate";
      est.recordDelta("");
      expect(est.tokenCount).toBe(0);
    });
  });

  // ── provider tokens ───────────────────────────────────────────────────

  describe("provider tokens", () => {
    it("falls back to direct counting when provider tokens are disabled", () => {
      const prov = new TimeMockedEngine(settings, 1000);
      prov.initialize();
      prov.start();
      // useProviderTokens is false by default: usageOutput is ignored and
      // the delta counts as 1 direct token
      prov.recordDelta("x", 5);
      expect(prov.tokenCount).toBe(1);
    });

    it("uses the provider-reported increment when enabled", () => {
      const prov = new TimeMockedEngine(settings, 1000);
      prov.initialize();
      prov.start();
      (prov as unknown as { _useProviderTokens: boolean })._useProviderTokens =
        true;
      prov.recordDelta("x", 10); // +10
      prov.recordDelta("x", 18); // +8
      expect(prov.tokenCount).toBe(18);
    });

    it("reconciles to the provider count instead of adding to it", () => {
      const prov = new TimeMockedEngine(settings, 1000);
      prov.initialize();
      prov.start();
      (prov as unknown as { _useProviderTokens: boolean })._useProviderTokens =
        true;
      prov.recordDelta("x", 10); // provider: 10
      prov.recordDelta("x", 10); // no progress
      prov.recordDelta("x", 25); // provider: 25
      // The provider is authoritative for the whole message: adding this
      // delta's own count on top of 25 would double-count a token that
      // produced nothing.
      expect(prov.tokenCount).toBe(25);
    });

    it("restarts the provider count at each assistant message boundary", () => {
      const prov = new TimeMockedEngine(settings, 1000);
      prov.initialize();
      prov.start();
      (prov as unknown as { _useProviderTokens: boolean })._useProviderTokens =
        true;
      prov.recordDelta("x", 10); // first message: 10
      prov.beginMessage(); // second assistant message counts from zero again
      prov.recordDelta("x", 5);
      expect(prov.tokenCount).toBe(15);
    });
  });

  // ── adaptive counting ─────────────────────────────────────────────────

  describe("adaptive counting", () => {
    /** Engine on `auto`, on a clock aligned with the 500 ms bar width. */
    const adaptive = (clock = 1000, at?: [string, string]) => {
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({ countStrategy: "auto" }),
        clock,
      );
      testEngine.initialize();
      if (at) testEngine.applyProvider(at[0], at[1]);
      testEngine.start();
      return testEngine;
    };

    it("counts text units while the endpoint is still uncalibrated", () => {
      const testEngine = adaptive();
      testEngine.recordDelta("hello world"); // 2 units
      testEngine.recordDelta(" hi!"); // 1 word + 1 punctuation
      expect(testEngine.tokensPerUnit).toBe(1);
      expect(testEngine.tokenCount).toBe(4);
    });

    it("does not collapse a batched delta to a single token", () => {
      // What a speculative-decoding server actually sends: one delta holding a
      // whole run of accepted tokens.
      const testEngine = adaptive();
      testEngine.recordDelta("The quick brown fox jumps over the lazy dog");
      expect(testEngine.tokenCount).toBe(9);
    });

    it("scores a whitespace-only delta as one token", () => {
      const testEngine = adaptive();
      testEngine.recordDelta("  ");
      expect(testEngine.tokenCount).toBe(1);
    });

    it("counts nothing for an empty delta", () => {
      const testEngine = adaptive();
      testEngine.recordDelta("");
      expect(testEngine.tokenCount).toBe(0);
    });

    it("learns this provider's tokens per unit from its final count", () => {
      const testEngine = adaptive(1000, ["litellm", "qwen-flash"]);
      testEngine.recordDelta("one two three four"); // 4 units
      testEngine.stop();
      testEngine.reconcileTotal(8); // provider: 8 tokens

      expect(testEngine.tokensPerUnit).toBeCloseTo(2, 5);

      // The next stream is measured in the provider's own units.
      testEngine.start();
      testEngine.recordDelta("one two three four");
      expect(testEngine.tokenCount).toBe(8);
    });

    it("keeps the ratio a correction leaves behind when the stream is over", () => {
      const testEngine = adaptive(1000, ["litellm", "qwen-flash"]);
      testEngine.recordDelta("a b");
      testEngine.stop();
      testEngine.reconcileTotal(6); // ratio 3

      // `initialize()` runs on every settings-menu change; forgetting the
      // ratio would make the next stream read wrong again.
      testEngine.initialize();
      testEngine.applyProvider("litellm", "qwen-flash");
      expect(testEngine.tokensPerUnit).toBeCloseTo(3, 5);
    });

    it("keys the ratio on the model as well as the provider", () => {
      const testEngine = adaptive(1000, ["litellm", "qwen-flash"]);
      testEngine.recordDelta("a b");
      testEngine.stop();
      testEngine.reconcileTotal(6);

      testEngine.applyProvider("litellm", "other-tokenizer");
      expect(testEngine.tokensPerUnit).toBe(1);
    });

    it("learns nothing from delta counting", () => {
      // `direct` counts deltas, so a ratio learned from it would describe the
      // server's batching rather than its tokenizer.
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({ countStrategy: "direct" }),
        1000,
      );
      testEngine.initialize();
      testEngine.start();

      testEngine.recordDelta("a b c d");
      testEngine.stop();
      testEngine.reconcileTotal(40);
      expect(testEngine.tokensPerUnit).toBe(1);
    });

    it("scales the recorded window when the correction lands", () => {
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({
          countStrategy: "direct",
          endTpsBehavior: "last",
          slidingWindow: 5000,
        }),
        1_000_000,
      );
      testEngine.initialize();
      testEngine.start();
      testEngine.recordDelta("x");
      // The only token landed at the start of the stream, so the window is still
      // at its floor: 1 token over 100 ms -> 10 tok/s.
      expect(testEngine.tps).toBe(10);

      testEngine.tick(500);
      testEngine.stop();
      testEngine.reconcileTotal(4);

      // The one recorded token is reported as four, so the reading must move by
      // the same factor or it would disagree with the number beside it.
      expect(testEngine.tokenCount).toBe(4);
      expect(testEngine.tps).toBe(40);
    });

    it("leaves the reading alone when the correction is inside tolerance", () => {
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({
          countStrategy: "direct",
          endTpsBehavior: "last",
          slidingWindow: 5000,
        }),
        1_000_000,
      );
      testEngine.initialize();
      testEngine.start();
      for (let i = 0; i < 100; i++) testEngine.recordDelta("x");
      // All 100 landed in the same instant, so the window is at its floor:
      // 100 tokens over 100 ms -> 1000 tok/s.
      expect(testEngine.tps).toBe(1000);

      testEngine.tick(500);
      testEngine.stop();
      testEngine.reconcileTotal(101); // 1% off: rescaling would be noise

      expect(testEngine.tokenCount).toBe(101);
      expect(testEngine.tps).toBe(1000);
    });
  });

  // ── reconcileTotal ────────────────────────────────────────────────────

  describe("reconcileTotal", () => {
    it("snaps the count to the authoritative value", () => {
      deltas(3);
      engine.reconcileTotal(1234);
      expect(engine.tokenCount).toBe(1234);
    });

    it("ignores non-positive totals", () => {
      deltas(3);
      engine.reconcileTotal(0);
      engine.reconcileTotal(-5);
      expect(engine.tokenCount).toBe(3);
    });

    it("ignores a turn that never streamed", () => {
      // A failed or empty turn reports usage while producing no deltas. The
      // retained window belongs to an earlier stream, so rescaling it would
      // report a rate computed from entirely different tokens.
      const testEngine = new TimeMockedEngine(
        makeSettingsMock({
          countStrategy: "direct",
          endTpsBehavior: "last",
          slidingWindow: 5000,
        }),
        1_000_000,
      );
      testEngine.initialize();
      testEngine.start();
      testEngine.recordDelta("x");
      testEngine.tick(500);
      testEngine.stop();
      testEngine.reconcileTotal(4);

      expect(testEngine.tokenCount).toBe(4);
      expect(testEngine.tps).toBe(40);

      // A second reconcile with no stream behind it must not rescale again.
      testEngine.reconcileTotal(400);
      expect(testEngine.tokenCount).toBe(4);
      expect(testEngine.tps).toBe(40);
    });
  });

  // ── ttft ──────────────────────────────────────────────────────────────

  describe("ttft", () => {
    it("is 0 before measurement", () => {
      expect(engine.ttft).toBe(0);
    });

    it("is captured only once per stream", () => {
      engine.startTTFT();
      engine.stopTTFT();
      const first = engine.ttft;
      // Additional stop calls must not overwrite the first capture
      engine.stopTTFT();
      expect(engine.ttft).toBe(first);
    });

    it("never reports a negative value", () => {
      engine.startTTFT();
      // stopTTFT not called yet: _ttftEnd is 0, so ttft would be negative
      // without the guard
      expect(engine.ttft).toBeGreaterThanOrEqual(0);
    });
  });

  // ── pause/resume ──────────────────────────────────────────────────────

  describe("pause/resume", () => {
    it("resumes on the next delta after a pause", () => {
      engine.pause();
      engine.recordDelta("x");
      expect(engine.isStreaming).toBe(true);
    });

    it("accumulates paused time", () => {
      engine.pause();
      engine.recordDelta("x");
      engine.pause();
      engine.recordDelta("x");
      // pausedMs should be >= 0 and the delta counted twice
      expect(engine.tokenCount).toBe(2);
      expect(engine.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it("does not bill a trailing tool call to the model", () => {
      const testEngine = new TimeMockedEngine(settings, 1000);
      testEngine.initialize();
      testEngine.start();
      testEngine.tick(1000); // one second of decoding
      testEngine.recordDelta("x");
      testEngine.pause(); // tool call ends; no further deltas arrive
      testEngine.tick(5000); // the tool runs for five seconds
      testEngine.stop();

      expect(testEngine.elapsedMs).toBe(1000);
    });

    it("does not carry an unfinished pause into the next stream", () => {
      const testEngine = new TimeMockedEngine(settings, 1000);
      testEngine.initialize();
      testEngine.start();
      testEngine.pause();
      testEngine.stop();

      testEngine.start();
      testEngine.tick(100);
      testEngine.recordDelta("x");

      // Resuming a pause that belonged to the previous stream would subtract a
      // five-second gap from a stream that has been running for 100ms.
      expect(testEngine.elapsedMs).toBe(100);
    });
  });

  // ── tps behavior ──────────────────────────────────────────────────────

  describe("tps behavior", () => {
    it("reports the sliding window tps while streaming", () => {
      deltas(5);
      // While streaming, tps reflects the last sliding-window measurement
      expect(engine.tps).toBe(engine["_tps"]);
    });

    it("falls back to the average after streaming ends (default behavior)", () => {
      const mocked = new TimeMockedEngine(settings, 1000);
      mocked.initialize();
      mocked.start();
      for (let i = 0; i < 5; i++) mocked.recordDelta("x");
      mocked.tick(5000); // advance 5s so elapsedSeconds > 0
      mocked.stop();
      // endTpsBehavior is "average": tps === tpsAvg after stop
      expect(mocked.tps).toBe(mocked.tpsAvg);
      // Verify the calculation path was hit
      expect(mocked.tpsAvg).toBeGreaterThan(0);
    });

    it("keeps the last window value when endTpsBehavior is 'last'", () => {
      const lastEngine = new TokenSpeedEngine(settings);
      lastEngine.initialize();
      (lastEngine as unknown as { _endTpsBehavior: string })._endTpsBehavior =
        "last";
      lastEngine.start();
      for (let i = 0; i < 5; i++) lastEngine.recordDelta("x");
      const beforeStop = lastEngine.tps;
      lastEngine.stop();
      expect(lastEngine.tps).toBe(beforeStop);
    });

    it("average is 0 before any time has elapsed", () => {
      const fresh = new TokenSpeedEngine(settings);
      fresh.initialize();
      expect(fresh.tpsAvg).toBe(0);
    });

    it("measures elapsed on a clock that starts at zero", () => {
      // `_startTime` must not double as the "never started" marker: a clock
      // whose first timestamp is 0 is legitimate, and reading it as "no stream"
      // silently zeroed the average for the whole turn.
      const testEngine = new TimeMockedEngine(settings, 0);
      testEngine.initialize();
      testEngine.start();
      for (let i = 0; i < 200; i++) testEngine.recordDelta("x");
      testEngine.tick(2000);
      testEngine.stop();

      expect(testEngine.elapsedMs).toBe(2000);
      expect(testEngine.tpsAvg).toBeCloseTo(100, 5); // 200 tokens / 2 s
    });
  });

  // ── stop ──────────────────────────────────────────────────────────────

  describe("stop", () => {
    it("marks the session as no longer streaming", () => {
      engine.stop();
      expect(engine.isStreaming).toBe(false);
    });

    it("ignores deltas after stopping", () => {
      engine.stop();
      engine.recordDelta("x");
      expect(engine.tokenCount).toBe(0);
    });

    it("can stop before initialization", () => {
      const eng = new TokenSpeedEngine(settings);
      expect(() => eng.stop()).not.toThrow();
    });

    it("can start before initialization", () => {
      const eng = new TokenSpeedEngine(settings);
      expect(() => eng.start()).not.toThrow();
    });
  });

  // ── applyProvider ─────────────────────────────────────────────────────

  describe("applyProvider", () => {
    it("calls resolveConfig with the providerId", () => {
      const resolveSpy = vi.spyOn(settings, "resolveConfig");
      const testEngine = new TokenSpeedEngine(settings);
      testEngine.initialize();
      testEngine.applyProvider("anthropic");
      expect(resolveSpy).toHaveBeenCalledWith("anthropic");
    });

    it("is a no-op when called with the same providerId", () => {
      const resolveSpy = vi.spyOn(settings, "resolveConfig");
      const testEngine = new TokenSpeedEngine(settings);
      testEngine.initialize();
      testEngine.applyProvider("anthropic");
      testEngine.applyProvider("anthropic");
      // Second call should not trigger another resolveConfig
      expect(resolveSpy).toHaveBeenCalledTimes(1);
    });

    it("is a no-op while streaming", () => {
      const resolveSpy = vi.spyOn(settings, "resolveConfig");
      const testEngine = new TimeMockedEngine(settings, 1000);
      testEngine.initialize();
      // Apply provider before streaming starts
      testEngine.applyProvider("anthropic");
      expect(resolveSpy).toHaveBeenCalledWith("anthropic");
      resolveSpy.mockClear();
      // Now start streaming and try again — should be a no-op
      testEngine.start();
      testEngine.applyProvider("openai");
      expect(resolveSpy).not.toHaveBeenCalled();
    });
  });
});
