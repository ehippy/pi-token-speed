import { describe, expect, it } from "vitest";

import { renderCells, SPARKLINE_BLOCKS } from "../src/sparkline/render";

const chars = (
  rates: number[],
  opts?: Partial<Parameters<typeof renderCells>[1]>,
): string =>
  renderCells(rates, {
    scale: "relative",
    ceiling: 100,
    gap: "low",
    ...opts,
  })
    .map((c) => c.char)
    .join("");

describe("renderCells", () => {
  describe("relative scale", () => {
    it("renders the tallest bar in view at full height", () => {
      expect(chars([0, 100])).toBe(`${SPARKLINE_BLOCKS[0]}█`);
    });

    it("quantizes rates against the peak in view", () => {
      expect(chars([50, 100])).toBe(`${SPARKLINE_BLOCKS[4]}█`);
      expect(chars([100, 25])).toBe(`█${SPARKLINE_BLOCKS[2]}`);
    });

    it("scales each series independently", () => {
      const slow = chars([0.5, 1]);
      const fast = chars([50, 100]);
      expect(slow).toBe(fast);
    });

    it("keeps a tiny bar visible as the lowest block", () => {
      expect(chars([1, 1000])).toBe(`${SPARKLINE_BLOCKS[0]}█`);
    });
  });

  describe("absolute scale", () => {
    it("renders the ceiling reference at full height", () => {
      expect(chars([100, 50], { scale: "absolute" })).toBe(
        `█${SPARKLINE_BLOCKS[4]}`,
      );
    });

    it("clamps rates above the ceiling", () => {
      expect(chars([400], { scale: "absolute" })).toBe("█");
    });

    it("falls back to relative when the ceiling is unusable", () => {
      expect(chars([400, 20], { scale: "absolute", ceiling: 0 })).toBe(
        `█${SPARKLINE_BLOCKS[0]}`,
      );
    });
  });

  describe("gaps", () => {
    it("draws empty bars as the lowest block by default", () => {
      expect(chars([0, 100], { gap: "low" })).toContain(SPARKLINE_BLOCKS[0]);
    });

    it("draws empty bars as blank space on request", () => {
      expect(chars([0, 100], { gap: "blank" })).toBe(` █`);
    });

    it("never produces NaN for an all-empty series", () => {
      expect(chars([0, 0, 0])).toBe("▁▁▁");
      expect(chars([])).toBe("");
    });
  });

  describe("cells", () => {
    it("reports each bar's own rate alongside its glyph", () => {
      const cells = renderCells([10, 20], {
        scale: "relative",
        ceiling: 100,
        gap: "low",
      });
      expect(cells.map((c) => c.tps)).toEqual([10, 20]);
    });
  });
});
