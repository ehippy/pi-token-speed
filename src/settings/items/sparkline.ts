import type { TokenSpeedConfig } from "../../config/types";
import { SettingsItem, ValidationResult } from "../base";
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
 * - `relative`: tallest bar in view is full height (shape is emphasized, but
 *   the whole graph rescales when that bar scrolls away)
 * - `peak`: held high watermark that relaxes over time (stable heights, no
 *   sudden rescaling)
 * - `absolute`: `thresholds.blazing` is full height (height is comparable
 *   across turns, bars above the ceiling clamp)
 */
export type SparklineScale = "relative" | "peak" | "absolute";

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
export const SPARKLINE_SCALE_DEFAULT: SparklineScale = "peak";
export const SPARKLINE_GAP_DEFAULT: SparklineGap = "low";

/**
 * Half-life of the held `peak` ceiling: how long an unchallenged peak takes to
 * fall to half height. Matches the time span the graph shows, so the scale
 * relaxes on the same clock as the history scrolling past it.
 */
export const SPARKLINE_HISTORY_MS_DEFAULT =
  SPARKLINE_BARS_DEFAULT * SPARKLINE_BAR_MS_DEFAULT;

const SPARKLINE_COLOR_MODE_LABELS: Record<SparklineColorMode, string> = {
  tier: "Per-bar tiers",
  head: "Highlight newest",
  mono: "Monochrome",
};

const SPARKLINE_SCALE_LABELS: Record<SparklineScale, string> = {
  relative: "Peak in view",
  peak: "Peak hold (relaxes)",
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
 * Formats a bar width for display, using the menu label when there is one.
 *
 * @param barMs Bar width in milliseconds.
 * @returns A human width such as `500 ms` or `1 s`.
 */
export function formatSparklineBarMs(barMs: number): string {
  return SPARKLINE_BAR_MS_LABELS[barMs] ?? `${barMs} ms`;
}

/**
 * Enum setting: how sparkline bars are colored.
 */
export class SparklineColorModeSettingsItem extends ScalarSettingsItem<SparklineColorMode> {
  constructor() {
    super({
      id: "sparklineColorMode",
      label: "Coloring",
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
      label: "Vertical scale",
      description:
        "Full height means the tallest bar in view, a held peak that relaxes toward it, or the blazing TPS threshold",
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
      label: "Gaps",
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
      label: "Length",
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
      label: "Bar width",
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
 *
 * The keys are flat (`sparklineBars`, …) rather than a nested object: each one
 * is an ordinary scalar setting, and `SparklineGroupSettingsItem` groups them
 * into a submenu.
 */
export const SPARKLINE_SETTINGS_ITEMS: ScalarSettingsItem<unknown>[] = [
  new SparklineBarsSettingsItem(),
  new SparklineBarMsSettingsItem(),
  new SparklineColorModeSettingsItem(),
  new SparklineScaleSettingsItem(),
  new SparklineGapSettingsItem(),
];

/**
 * Id of the sparkline submenu row.
 */
export const SPARKLINE_GROUP_ID = "sparkline";

/**
 * Flat config keys edited by the sparkline submenu.
 */
export const SPARKLINE_IDS: readonly string[] = SPARKLINE_SETTINGS_ITEMS.map(
  (i) => i.id,
);

/**
 * Group row that opens the sparkline submenu.
 *
 * It has no value of its own (`format()` is undefined, which is how the
 * settings menu recognizes group rows) and no config field of its own; the
 * individual settings are edited in the submenu.
 */
export class SparklineGroupSettingsItem extends SettingsItem {
  readonly id = SPARKLINE_GROUP_ID;
  readonly label = "Sparkline";
  readonly description =
    "History graph of recent token throughput — one bar per time slice";

  format(_config: TokenSpeedConfig): string | undefined {
    return undefined;
  }

  setConfig(_config: TokenSpeedConfig, _value: string): ValidationResult {
    return {
      valid: false,
      errors: ["Sparkline is a group — edit a setting inside its submenu"],
    };
  }
}
