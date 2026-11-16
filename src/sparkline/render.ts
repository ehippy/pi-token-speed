import type { SparklineGap, SparklineScale } from "../settings/items/sparkline";

/** Block glyphs, shortest to tallest. */
export const SPARKLINE_BLOCKS = [
  "▁",
  "▂",
  "▃",
  "▄",
  "▅",
  "▆",
  "▇",
  "█",
] as const;

/** One rendered bar: its rate and the glyph standing for it. */
export interface SparklineCell {
  /** Averaged tokens per second for the bar's time slot. */
  readonly tps: number;
  /** Glyph for the bar — blank for an empty bar in `blank` gap mode. */
  readonly char: string;
}

/** Rates a vertical scale can be chosen from. */
export interface CeilingSource {
  /** Rates of the bars about to be drawn. */
  readonly rates: readonly number[];
  /** Held peak from `PeakCeiling`, used by `peak` scaling. */
  readonly sticky: number;
  /** `thresholds.blazing`, used by `absolute` scaling. */
  readonly blazing: number;
}

/** Options controlling how rates map to glyphs. */
export interface SparklineRenderOptions {
  /** Rate that maps to the tallest block. */
  readonly ceiling: number;
  /** How to draw bars with no tokens. */
  readonly gap: SparklineGap;
}

/**
 * Chooses the rate that maps to full height.
 *
 * Each mode falls back to the tallest bar in view when its reference is not
 * usable — an unset blazing threshold or a peak that has not seen any tokens
 * yet would otherwise divide by zero and flatten the graph to empty slots.
 *
 * @param scale Vertical scaling mode.
 * @param source Rates available to scale against.
 * @returns The ceiling to quantize bars against.
 */
export function resolveCeiling(
  scale: SparklineScale,
  source: CeilingSource,
): number {
  const observed = source.rates.reduce((max, rate) => Math.max(max, rate), 0);

  let preferred: number;
  switch (scale) {
    case "absolute":
      preferred = source.blazing;
      break;
    case "peak":
      preferred = source.sticky;
      break;
    case "relative":
    default:
      preferred = observed;
  }

  return preferred > 0 ? preferred : observed;
}

/**
 * Maps token rates to sparkline glyphs.
 *
 * Rates are quantized against `ceiling` into the eight block glyphs by the
 * band they fall in, so a bar never rounds up to a height it did not reach.
 * Rates above the ceiling clamp to the tallest block, which is what keeps
 * `absolute` and `peak` scaling stable through a burst. Any positive rate too
 * small to register still draws the shortest block, so a trickle is visible.
 *
 * @param rates Averaged tokens per second per bar, oldest first.
 * @param opts Resolved ceiling and gap style.
 * @returns One cell per rate, oldest first.
 */
export function renderCells(
  rates: readonly number[],
  opts: SparklineRenderOptions,
): SparklineCell[] {
  const top = SPARKLINE_BLOCKS.length - 1;

  return rates.map((tps) => {
    if (tps <= 0) {
      return { tps, char: opts.gap === "blank" ? " " : SPARKLINE_BLOCKS[0] };
    }

    const level =
      opts.ceiling > 0
        ? Math.min(top, Math.floor((tps / opts.ceiling) * top))
        : 0;

    return { tps, char: SPARKLINE_BLOCKS[level] };
  });
}
