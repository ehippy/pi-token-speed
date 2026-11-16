import { describe, expect, it } from "vitest";

import type { SparklineGap } from "../src/settings/items/sparkline";
import {
  renderCells,
  resolveCeiling,
  SPARKLINE_BLOCKS,
} from "../src/sparkline/render";

const chars = (
  rates: number[],
  opts: Partial<{ ceiling: number; gap: SparklineGap }> = {},
): string =>
  renderCells(rates, { ceiling: 100, gap: "low", ...opts })
    .map((c) => c.char)
    .join("");

describe("resolveCeiling", () => {
  const source = { rates: [10, 60, 30], sticky: 200, blazing: 45 };

  it("uses the tallest bar in view for relative scaling", () => {
    expect(resolveCeiling("relative", source)).toBe(60);
  });

  it("uses the held peak for peak scaling, even after it scrolled away", () => {
    expect(resolveCeiling("peak", source)).toBe(200);
  });

  it("uses the blazing threshold for absolute scaling", () => {
    expect(resolveCeiling("absolute", source)).toBe(45);
  });

  it("falls back to the visible peak before any data has arrived", () => {
    expect(resolveCeiling("peak", { ...source, sticky: 0 })).toBe(60);
  });

  it("falls back to the visible peak when the threshold is unset", () => {
    expect(resolveCeiling("absolute", { ...source, blazing: 0 })).toBe(60);
  });

  it("has nothing to scale for an empty series", () => {
    expect(resolveCeiling("peak", { rates: [], sticky: 0, blazing: 45 })).toBe(
      0,
    );
  });
});

describe("renderCells", () => {
  describe("quantizing against the ceiling", () => {
    it("renders a rate at the ceiling full height", () => {
      expect(chars([100])).toBe("█");
    });

    it("halves the height for half the ceiling", () => {
      expect(chars([50, 100])).toBe(`${SPARKLINE_BLOCKS[3]}█`);
    });

    it("never rounds a bar up to a level it did not reach", () => {
      expect(chars([99], { ceiling: 100 })).toBe(SPARKLINE_BLOCKS[6]);
    });

    it("clamps rates above the ceiling", () => {
      expect(chars([400])).toBe("█");
    });

    it("keeps a tiny bar visible as the lowest block", () => {
      expect(chars([1, 1000], { ceiling: 1000 })).toBe(
        `${SPARKLINE_BLOCKS[0]}█`,
      );
    });

    it("draws the same shape for the same proportions", () => {
      expect(chars([0.5, 1], { ceiling: 1 })).toBe(chars([50, 100]));
    });
  });

  describe("gaps", () => {
    it("draws empty bars as the lowest block by default", () => {
      expect(chars([0, 100], { gap: "low" })).toBe(`${SPARKLINE_BLOCKS[0]}█`);
    });

    it("draws empty bars as blank space on request", () => {
      expect(chars([0, 100], { gap: "blank" })).toBe(` █`);
    });

    it("never produces NaN for an all-empty series", () => {
      expect(chars([0, 0, 0], { ceiling: 0 })).toBe("▁▁▁");
      expect(chars([], { ceiling: 0 })).toBe("");
    });
  });

  it("reports each bar's own rate alongside its glyph", () => {
    const cells = renderCells([10, 20], { ceiling: 100, gap: "low" });
    expect(cells.map((c) => c.tps)).toEqual([10, 20]);
  });
});
