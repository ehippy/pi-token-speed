import { describe, expect, it } from "vitest";

import { TokenBars } from "../src/sparkline/bars";

/** Bars aligned to a bucket boundary so slot maths stays obvious. */
const ALIGNED = 1_000_000; // divisible by any barMs below

const tokensOf = (bars: { tokens: number }[]) => bars.map((b) => b.tokens);

describe("TokenBars", () => {
  describe("series shape", () => {
    it("returns the configured number of zero bars with no data", () => {
      const bars = new TokenBars(500, 8);
      const series = bars.series(ALIGNED);
      expect(series).toHaveLength(8);
      expect(tokensOf(series)).toEqual(new Array(8).fill(0));
    });

    it("places bars oldest first, ending with the newest completed slot", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED + 1500); // bucket 2003, in flight
      expect(tokensOf(bars.series(ALIGNED + 2000))).toEqual([0, 0, 0, 10]);
    });

    it("reports the span covered by the retained history", () => {
      expect(new TokenBars(500, 20).spanMs).toBe(10_000);
    });
  });

  describe("fixed-width averaging", () => {
    it("divides a completed bar's tokens by the full bar width", () => {
      const bars = new TokenBars(500, 8);
      bars.add(50, ALIGNED); // bucket 2000
      bars.add(50, ALIGNED + 400); // same bucket

      // Read two slots later, so bucket 2000 is complete but still in view
      const [bar] = bars.series(ALIGNED + 1000).filter((b) => b.tokens === 100);
      expect(bar.tps).toBe(200); // 100 tokens / 0.5s
    });

    it("keeps separate slots separate instead of blending them", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED); // bucket 2000
      bars.add(20, ALIGNED + 500); // bucket 2001

      expect(tokensOf(bars.series(ALIGNED + 1000))).toEqual([0, 0, 10, 20]);
    });

    it("hides the slot still being filled so every bar spans full width", () => {
      const bars = new TokenBars(1000, 4);
      bars.add(30, ALIGNED); // start of bucket 1000

      // A chunk landing in the first 200ms would read 150 tok/s if the
      // in-flight slot were drawn; the newest bar stays empty until it closes.
      expect(tokensOf(bars.series(ALIGNED + 200))).toEqual([0, 0, 0, 0]);

      // Once closed it is averaged over the whole second it covers.
      const current = bars.series(ALIGNED + 1000).at(-1)!;
      expect(current.tokens).toBe(30);
      expect(current.tps).toBe(30); // 30 / 1s, not 30 / 0.2s
    });
  });

  describe("stalls", () => {
    it("leaves slots with no tokens as empty bars", () => {
      const bars = new TokenBars(500, 7);
      bars.add(25, ALIGNED); // bucket 2000
      bars.add(25, ALIGNED + 3000); // bucket 2006 — five empty slots between

      expect(tokensOf(bars.series(ALIGNED + 3500))).toEqual([
        25, 0, 0, 0, 0, 0, 25,
      ]);
    });
  });

  describe("retention", () => {
    it("drops bars that scrolled out of the window", () => {
      const bars = new TokenBars(500, 3);
      bars.add(10, ALIGNED); // bucket 2000
      bars.add(10, ALIGNED + 5000); // bucket 2010

      expect(tokensOf(bars.series(ALIGNED + 5500))).toEqual([0, 0, 10]);
      expect((bars as any).buckets.size).toBe(1);
    });

    it("keeps memory bounded over a long stream", () => {
      const bars = new TokenBars(100, 5);
      for (let t = 0; t < 100_000; t += 10) bars.add(1, t);
      expect((bars as any).buckets.size).toBeLessThanOrEqual(6);
    });
  });

  describe("configure", () => {
    it("discards history when the bar width changes", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);
      expect(bars.configure(1000, 4)).toBe(true);
      expect(tokensOf(bars.series(ALIGNED + 2000))).toEqual([0, 0, 0, 0]);
    });

    it("keeps history and reports no change when nothing changed", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);
      expect(bars.configure(500, 4)).toBe(false);
      expect(bars.series(ALIGNED + 500).at(-1)!.tokens).toBe(10);
    });

    it("applies a new bar count", () => {
      const bars = new TokenBars(500, 4);
      bars.configure(500, 10);
      expect(bars.series(ALIGNED)).toHaveLength(10);
    });
  });

  describe("recorded tokens", () => {
    it("ignores non-positive additions", () => {
      const bars = new TokenBars(500, 4);
      bars.add(0, ALIGNED);
      bars.add(-5, ALIGNED);
      expect(bars.series(ALIGNED + 500).at(-1)!.tokens).toBe(0);
    });

    it("reset() clears every bucket", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);
      bars.reset();
      expect(bars.series(ALIGNED + 500).at(-1)!.tokens).toBe(0);
    });
  });

  describe("rescaling after an authoritative correction", () => {
    it("multiplies every retained bucket", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);
      bars.add(6, ALIGNED + 500);

      bars.scale(3);

      expect(tokensOf(bars.series(ALIGNED + 1000))).toEqual([0, 0, 30, 18]);
    });

    it("carries through to the averaged rate", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);
      expect(bars.series(ALIGNED + 500).at(-1)!.tps).toBe(20);

      bars.scale(2.5);

      expect(bars.series(ALIGNED + 500).at(-1)!.tps).toBe(50);
    });

    it("ignores a neutral or unusable factor", () => {
      const bars = new TokenBars(500, 4);
      bars.add(10, ALIGNED);

      bars.scale(1);
      bars.scale(0);
      bars.scale(-3);
      bars.scale(Number.NaN);

      expect(bars.series(ALIGNED + 500).at(-1)!.tokens).toBe(10);
    });
  });
});
