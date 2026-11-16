import { ScalarSettingsItem } from "./scalar";

/**
 * How sparkline bars are colored.
 *
 * - `tier`: each bar takes the color of its own TPS tier (reuses `colors.*`)
 * - `head`: only the newest bar is tier-colored; history is dimmed
 * - `mono`: no colors; bars follow `suffixTheme`
 */
export type SparklineColorMode = "tier" | "head" | "mono";

/**
 * Vertical scale of the bars.
 *
 * - `relative`: tallest bar in view is full height (shape is emphasized)
 * - `absolute`: `thresholds.blazing` is full height (height is comparable
 *   across turns, bars above the ceiling clamp)
 */
export type SparklineScale = "relative" | "absolute";

/**
 * How a bar with no tokens (a stall or idle slot) is drawn.
 *
 * - `low`: shortest block, so gaps are visible as a flat line
 * - `blank`: space, so gaps read as a break in the graph
 */
export type SparklineGap = "low" | "blank";

export const SPARKLINE_BARS_DEFAULT = 20;
export const SPARKLINE_BAR_MS_DEFAULT = 500;
export const SPARKLINE_COLOR_MODE_DEFAULT: SparklineColorMode = "tier";
export const SPARKLINE_SCALE_DEFAULT: SparklineScale = "relative";
export const SPARKLINE_GAP_DEFAULT: SparklineGap = "low";

const SPARKLINE_COLOR_MODE_LABELS: Record<SparklineColorMode, string> = {
  tier: "Per-bar tiers",
  head: "Highlight newest",
  mono: "Monochrome",
};

const SPARKLINE_SCALE_LABELS: Record<SparklineScale, string> = {
  relative: "Relative to peak",
  absolute: "Absolute (blazing = full)",
};

const SPARKLINE_GAP_LABELS: Record<SparklineGap, string> = {
  low: "Low block",
  blank: "Blank",
};

/** Millisecond widths offered in the menu; other values remain valid. */
const SPARKLINE_BAR_MS_LABELS: Record<number, string> = {
  100: "100 ms",
  250: "250 ms",
  500: "500 ms",
  1000: "1 s",
  2000: "2 s",
  5000: "5 s",
};

/**
 * Enum setting: how sparkline bars are colored.
 */
export class SparklineColorModeSettingsItem extends ScalarSettingsItem<SparklineColorMode> {
  constructor() {
    super({
      id: "sparklineColorMode",
      label: "Sparkline coloring",
      description:
        "Color every bar by its TPS tier, highlight only the newest bar, or keep it monochrome",
      default: SPARKLINE_COLOR_MODE_DEFAULT,
      labels: SPARKLINE_COLOR_MODE_LABELS,
    });
  }
}

/**
 * Enum setting: vertical scale of sparkline bars.
 */
export class SparklineScaleSettingsItem extends ScalarSettingsItem<SparklineScale> {
  constructor() {
    super({
      id: "sparklineScale",
      label: "Sparkline scale",
      description:
        "Scale bars against the peak in view, or against the blazing threshold",
      default: SPARKLINE_SCALE_DEFAULT,
      labels: SPARKLINE_SCALE_LABELS,
    });
  }
}

/**
 * Enum setting: how empty sparkline bars (stalls) are drawn.
 */
export class SparklineGapSettingsItem extends ScalarSettingsItem<SparklineGap> {
  constructor() {
    super({
      id: "sparklineGap",
      label: "Sparkline gaps",
      description: "Draw bars with no tokens as a low block or as blank space",
      default: SPARKLINE_GAP_DEFAULT,
      labels: SPARKLINE_GAP_LABELS,
    });
  }
}

/**
 * Numeric setting: number of sparkline bars (3–60).
 * Total history shown is `sparklineBars × sparklineBarMs`.
 */
export class SparklineBarsSettingsItem extends ScalarSettingsItem<number> {
  constructor() {
    super({
      id: "sparklineBars",
      label: "Sparkline length",
      description: "Number of bars in the graph",
      default: SPARKLINE_BARS_DEFAULT,
      min: 3,
      max: 60,
    });
  }
}

/**
 * Numeric setting: width of one sparkline bar in milliseconds (50–10000).
 * Each bar averages the tokens that arrived in its slot, so wider bars
 * smooth out more fluctuation.
 */
export class SparklineBarMsSettingsItem extends ScalarSettingsItem<number> {
  constructor() {
    super({
      id: "sparklineBarMs",
      label: "Sparkline bar width",
      description:
        "Time each bar covers and averages over — wider bars smooth more",
      default: SPARKLINE_BAR_MS_DEFAULT,
      labels: SPARKLINE_BAR_MS_LABELS,
      min: 50,
      max: 10000,
    });
  }
}

/**
 * Sparkline settings in menu order.
 */
export const SPARKLINE_SETTINGS_ITEMS: ScalarSettingsItem<unknown>[] = [
  new SparklineBarsSettingsItem(),
  new SparklineBarMsSettingsItem(),
  new SparklineColorModeSettingsItem(),
  new SparklineScaleSettingsItem(),
  new SparklineGapSettingsItem(),
];
