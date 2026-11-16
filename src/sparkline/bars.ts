import {
  SPARKLINE_BAR_MS_DEFAULT,
  SPARKLINE_BARS_DEFAULT,
} from "../settings/items/sparkline";

/**
 * Shortest span (ms) a bar averages over.
 *
 * A bar is normally averaged over its full width, but the bar being filled
 * right now has only been accumulating since it started. Flooring the span
 * keeps a burst landing in the first milliseconds of a fresh bar — or the
 * very first delta of a stream — from dividing by ~0 and rendering as a
 * full-height spike.
 */
export const MIN_BAR_SPAN_MS = 50;

/** A single sparkline bar: raw tokens plus the averaged rate for its slot. */
export interface TokenBar {
  /** Tokens recorded in the bar's time slot. */
  readonly tokens: number;
  /** Tokens per second, averaged over the bar's time slot. */
  readonly tps: number;
}

/**
 * Fixed-time-bucket token histogram backing the sparkline.
 *
 * Tokens are summed into buckets of a fixed width (`barMs`) keyed by absolute
 * time, then each bucket is divided by its own width to get a rate. Averaging
 * over a fixed slot absorbs the fluctuation of individual deltas, and because
 * slots exist whether or not tokens arrived, a stall shows up as an empty bar
 * instead of being silently skipped.
 *
 * Buckets outside the retained range are dropped, so memory is bounded by
 * `bars` regardless of how long a stream runs.
 */
export class TokenBars {
  /** Absolute bucket index (`floor(now / barMs)`) → tokens recorded in it. */
  private readonly buckets = new Map<number, number>();

  constructor(
    private barMs: number = SPARKLINE_BAR_MS_DEFAULT,
    private bars: number = SPARKLINE_BARS_DEFAULT,
  ) {}

  /**
   * Re-applies bar width and bar count, discarding recorded history.
   * Existing buckets are keyed to the old width, so they cannot be reused.
   *
   * @param barMs Bar width in milliseconds.
   * @param bars Number of bars retained.
   */
  configure(barMs: number, bars: number): void {
    if (barMs === this.barMs && bars === this.bars) return;
    this.barMs = barMs;
    this.bars = bars;
    this.reset();
  }

  /**
   * Adds tokens to the bucket covering `now`, dropping buckets that have
   * scrolled out of the retained range.
   *
   * @param tokens Tokens recorded.
   * @param now Current timestamp in milliseconds.
   */
  add(tokens: number, now: number): void {
    if (tokens <= 0) return;

    const index = Math.floor(now / this.barMs);
    this.buckets.set(index, (this.buckets.get(index) ?? 0) + tokens);

    const oldest = index - this.bars + 1;
    for (const key of this.buckets.keys()) {
      if (key < oldest) this.buckets.delete(key);
    }
  }

  /**
   * Returns the retained bars, oldest first, always `bars` entries long.
   *
   * Completed bars are averaged over the full bar width; the bar covering
   * `now` is averaged over the time elapsed in it (floored at
   * {@link MIN_BAR_SPAN_MS}) so the live bar reads as a rate rather than
   * ramping up from zero as the bar fills. Empty slots become zero bars.
   *
   * @param now Current timestamp in milliseconds.
   */
  series(now: number): TokenBar[] {
    const current = Math.floor(now / this.barMs);
    const series: TokenBar[] = [];

    for (let offset = this.bars - 1; offset >= 0; offset--) {
      const index = current - offset;
      const tokens = this.buckets.get(index) ?? 0;
      const span =
        index === current
          ? Math.min(
              Math.max(now - index * this.barMs, MIN_BAR_SPAN_MS),
              this.barMs,
            )
          : this.barMs;

      series.push({
        tokens,
        tps: tokens > 0 ? (1000 * tokens) / span : 0,
      });
    }

    return series;
  }

  /** Discards all recorded buckets. */
  reset(): void {
    this.buckets.clear();
  }
}
