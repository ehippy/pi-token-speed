import { beforeEach, describe, expect, it } from "vitest";

import { MIN_SLIDING_WINDOW } from "../src/config/constants";
import { SlidingWindow } from "../src/core/sliding-window";

const t0 = 10_000;

describe("SlidingWindow", () => {
  let w: SlidingWindow;

  beforeEach(() => {
    w = new SlidingWindow(1000);
  });

  it("returns 0 when empty", () => {
    expect(w.getTps(t0)).toBe(0);
  });

  it("returns 0 when all events are older than the window", () => {
    w.record(10, t0);
    expect(w.getTps(t0 + 10_000)).toBe(0);
  });

  it("measures over the full window once the stream is older than it", () => {
    w.record(30, t0);
    w.record(40, t0 + 500);
    // Both events fall in [t0, t0+1000]; the interval is the window, not the
    // gap between the first and last arrival.
    expect(w.getTps(t0 + 1000)).toBeCloseTo(70, 5);
  });

  it("truncates the interval for a stream younger than the window", () => {
    w.record(50, t0);
    // 100ms of stream can only evidence 100ms of rate: 50 tokens → 500 tok/s
    expect(w.getTps(t0 + 100)).toBeCloseTo(500, 5);
  });

  it("floors the interval so a first flush cannot read as an absurd rate", () => {
    w.record(30, t0);
    // Zero elapsed time: the rate is capped at what MIN_SLIDING_WINDOW allows
    expect(w.getTps(t0)).toBe((1000 * 30) / MIN_SLIDING_WINDOW);
  });

  it("never credits tokens to time before the first event", () => {
    const wide = new SlidingWindow(2000);
    wide.record(20, t0);
    wide.record(10, t0 + 500);
    wide.record(10, t0 + 800);
    // The window reaches 1200ms before the stream began; the interval stops at
    // the first event, so 40 tokens over 800ms rather than over 2s.
    expect(wide.getTps(t0 + 800)).toBeCloseTo(50, 5);
  });

  it("excludes tokens recorded before the window from the count", () => {
    w.record(100, t0);
    w.record(25, t0 + 1000);
    w.record(25, t0 + 1400);
    // Only the last two are inside [t0+500, t0+1500]: 50 tokens over the whole
    // window, not over the 400ms between them.
    expect(w.getTps(t0 + 1500)).toBeCloseTo(50, 5);
  });

  it("returns 0 when the window contains only zero-token events", () => {
    w.record(0, t0);
    expect(w.getTps(t0 + 10)).toBe(0);
  });

  it("measures a buffered flush against the quiet period it followed", () => {
    // Issue #12: a proxy that buffers and flushes was idle, and a rate that
    // ignores the silence reads as thousands of tok/s for one refresh.
    w.record(10, t0);
    w.record(300, t0 + 5000);
    // 300 tokens attributed across the 5s that produced them, not the 500ms
    // window they landed in (which would read 600) and not their own 0ms span.
    expect(w.getTps(t0 + 5000)).toBeCloseTo(60, 5);
  });

  it("dilutes a flush, not a sparse tail", () => {
    // The replaced rule applied the same dilution whenever the window held a
    // single arrival, so a slow stream with a quiet tail read high instead.
    w.record(10, t0);
    w.record(15, t0 + 5000);
    w.record(15, t0 + 5400);
    // Two arrivals in the window: the interval is the window, 30 tokens/1s.
    expect(w.getTps(t0 + 5400)).toBeCloseTo(30, 5);
  });

  it("scales recorded batches when an authoritative count corrects them", () => {
    w.record(50, t0);
    const before = w.getTps(t0 + 400);
    w.scale(2);
    expect(w.getTps(t0 + 400)).toBeCloseTo(before * 2, 5);
  });

  it("ignores a non-positive or neutral scale factor", () => {
    w.record(50, t0);
    const before = w.getTps(t0 + 400);
    w.scale(1);
    w.scale(0);
    w.scale(-2);
    expect(w.getTps(t0 + 400)).toBeCloseTo(before, 5);
  });

  it("reset clears events and the stream-start time", () => {
    w.record(100, t0);
    w.reset();
    expect(w.getTps(t0 + 10)).toBe(0);
    expect(w["events"]).toHaveLength(0);
    expect(w["windowStartIndex"]).toBe(0);
    expect(w["firstTime"]).toBeUndefined();
  });

  it("uses the window itself as the floor when the window is very short", () => {
    const tiny = new SlidingWindow(50);
    tiny.record(10, t0);
    // MIN_SLIDING_WINDOW (100ms) exceeds the window, so the window wins
    expect(tiny.getTps(t0)).toBe((1000 * 10) / 50);
  });

  it("compacts old events once the dead prefix reaches the threshold", () => {
    // Exceed COMPACTION_THRESHOLD (5000) stale events
    for (let i = 0; i < 5001; i++) w.record(1, t0);
    // getTps advances windowStartIndex past every stale event
    w.getTps(t0 + 60_000);
    expect(w["windowStartIndex"]).toBe(5001);
    w.record(1, t0 + 61_000); // triggers compaction
    expect(w["windowStartIndex"]).toBe(0);
    expect(w["events"]).toHaveLength(1);
    expect(w["events"][0].tokens).toBe(1); // only the fresh event remains
  });
});
