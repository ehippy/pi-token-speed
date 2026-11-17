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
    w.record(100, t0);
    // Query 10s later but within a window that starts after the event: the
    // interval is the window (1000ms), not the 10s since the event.
    w.record(20, t0 + 9_000);
    expect(w.getTps(t0 + 10_000)).toBeCloseTo(20, 5);
  });

  it("excludes tokens recorded before the window from the count", () => {
    w.record(100, t0);
    w.record(50, t0 + 1000);
    // Only the second event is inside [t0+500, t0+1500]
    expect(w.getTps(t0 + 1500)).toBeCloseTo(50, 5);
  });

  it("returns 0 when the window contains only zero-token events", () => {
    w.record(0, t0);
    expect(w.getTps(t0 + 10)).toBe(0);
  });

  it("bounds a post-stall flush by the window instead of by its own span", () => {
    // A provider that buffers, or a tool call, then a batch landing at once:
    // measuring it over its own ~0ms span would read as thousands of tok/s.
    w.record(10, t0);
    w.record(300, t0 + 5000);
    expect(w.getTps(t0 + 5000)).toBeCloseTo(300, 5);
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
