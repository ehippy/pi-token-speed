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

/** Options controlling how rates map to glyphs. */
export interface SparklineRenderOptions {
  /** Vertical scaling mode. */
  readonly scale: SparklineScale;
  /** Full-height reference for `absolute` scale (the blazing threshold). */
  readonly ceiling: number;
  /** How to draw bars with no tokens. */
  readonly gap: SparklineGap;
}

/**
 * Maps token rates to sparkline glyphs.
 *
 * Rates are normalized against a ceiling — the tallest bar in view for
 * `relative` scale, the blazing threshold for `absolute` — then quantized to
 * the eight block glyphs. Values above the ceiling clamp to the tallest block.
 *
 * @param rates Averaged tokens per second per bar, oldest first.
 * @param opts Scaling and gap options.
 * @returns One cell per rate, oldest first.
 */
export function renderCells(
  rates: readonly number[],
  opts: SparklineRenderOptions,
): SparklineCell[] {
  const peak = rates.reduce((max, rate) => Math.max(max, rate), 0);
  const ceiling =
    opts.scale === "absolute" && opts.ceiling > 0 ? opts.ceiling : peak;
  const top = SPARKLINE_BLOCKS.length - 1;

  return rates.map((tps) => {
    if (tps <= 0) {
      return { tps, char: opts.gap === "blank" ? " " : SPARKLINE_BLOCKS[0] };
    }
    const level =
      ceiling <= 0 ? 0 : Math.min(top, Math.round((tps / ceiling) * top));
    return { tps, char: SPARKLINE_BLOCKS[level] };
  });
}
