import { describe, expect, it } from "vitest";

import { PeakCeiling } from "../src/sparkline/ceiling";
import { SPARKLINE_HISTORY_MS_DEFAULT } from "../src/settings/items/sparkline";

describe("PeakCeiling", () => {
  it("starts flat", () => {
    expect(new PeakCeiling(1000).update(0, 0)).toBe(0);
  });

  it("rises to a new peak immediately", () => {
    const ceiling = new PeakCeiling(1000);
    expect(ceiling.update(1000, 40)).toBe(40);
  });

  it("stays flat while samples keep reaching the peak", () => {
    const ceiling = new PeakCeiling(1000);
    ceiling.update(0, 40);
    expect(ceiling.update(100, 40)).toBe(40);
    expect(ceiling.update(250, 40)).toBe(40);
  });

  it("relaxes toward a lower sample instead of snapping to it", () => {
    const ceiling = new PeakCeiling(1000);
    ceiling.update(0, 40);

    const relaxed = ceiling.update(100, 10);
    expect(relaxed).toBeLessThan(40);
    expect(relaxed).toBeGreaterThan(10);
  });

  it("decays an unchallenged peak by half every half-life", () => {
    const ceiling = new PeakCeiling(1000);
    ceiling.update(0, 40);

    expect(ceiling.update(1000, 0)).toBeCloseTo(20, 6);
    expect(ceiling.update(2000, 0)).toBeCloseTo(10, 6);
  });

  it("reaches the same value whether updates are dense or sparse", () => {
    const sparse = new PeakCeiling(1000);
    sparse.update(0, 40);

    const dense = new PeakCeiling(1000);
    dense.update(0, 40);
    for (let t = 50; t <= 1000; t += 50) dense.update(t, 0);

    expect(dense.value).toBeCloseTo(sparse.update(1000, 0), 10);
  });

  it("never decays below the newest sample", () => {
    const ceiling = new PeakCeiling(1000);
    ceiling.update(0, 40);
    expect(ceiling.update(5000, 12)).toBe(12);
  });

  it("ignores a clock that moves backwards", () => {
    const ceiling = new PeakCeiling(1000);
    ceiling.update(5000, 40);
    expect(ceiling.update(4000, 0)).toBe(40);
  });

  describe("configure", () => {
    it("forgets the held peak when the half-life changes", () => {
      const ceiling = new PeakCeiling(1000);
      ceiling.update(0, 40);

      expect(ceiling.configure(2000)).toBe(true);
      expect(ceiling.value).toBe(0);
    });

    it("keeps the held peak when nothing changed", () => {
      const ceiling = new PeakCeiling(1000);
      ceiling.update(0, 40);

      expect(ceiling.configure(1000)).toBe(false);
      expect(ceiling.value).toBe(40);
    });

    it("ignores a non-positive half-life", () => {
      const ceiling = new PeakCeiling(1000);
      expect(ceiling.configure(0)).toBe(true);

      ceiling.update(0, 40);
      expect(ceiling.update(1000, 0)).toBeCloseTo(
        40 * 0.5 ** (1000 / SPARKLINE_HISTORY_MS_DEFAULT),
        6,
      );
    });
  });

  it("defaults to the span of the visible history", () => {
    const ceiling = new PeakCeiling();
    ceiling.update(0, 40);
    expect(ceiling.update(SPARKLINE_HISTORY_MS_DEFAULT, 0)).toBeCloseTo(20, 6);
  });
});
