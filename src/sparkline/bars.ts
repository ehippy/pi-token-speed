import {
  SPARKLINE_BAR_MS_DEFAULT,
  SPARKLINE_BARS_DEFAULT,
} from "../settings/items/sparkline";

/** A single sparkline bar: raw tokens plus the averaged rate for its slot. */
export interface TokenBar {
  /** Tokens recorded in the bar's time slot. */
  readonly tokens: number;
  /** Tokens per second, averaged over the full bar width. */
  readonly tps: number;
}

/** Everything the sparkline needs to draw: history plus a vertical scale. */
export interface SparklineView {
  /** Completed bars, oldest first, `bars` entries long. */
  readonly bars: readonly TokenBar[];
  /** Sticky peak rate the bars should be scaled against. */
  readonly ceiling: number;
}

/**
 * Fixed-time-bucket token histogram backing the sparkline.
 *
 * Tokens are summed into buckets of a fixed width (`barMs`) keyed by absolute
 * time, then each bucket is divided by that width to get a rate. Averaging
 * over a fixed slot absorbs the fluctuation of individual deltas, and because
 * slots exist whether or not tokens arrived, a stall shows up as an empty bar
 * instead of being silently skipped.
 *
 * Only *completed* buckets are reported: the bucket being filled right now is
 * excluded, so every bar shown is averaged over an identical span. Reporting
 * the in-flight bucket instead would overstate the newest bar badly — a chunk
 * landing in the first 50ms of a 500ms bucket reads as 10x its real rate
 * before sagging back as the bucket fills — which makes the newest bar pulse on
 * every boundary. The cost is at most one bar width of lag, which a graph this
 * coarse does not show.
 *
 * Buckets outside the retained range are dropped, so memory is bounded by
 * `bars` regardless of how long a stream runs.
 */
export class TokenBars {
  /** Absolute bucket index (`floor(now / barMs)`) → tokens recorded in it. */
  private buckets = new Map<number, number>();

  constructor(
    private barMs: number = SPARKLINE_BAR_MS_DEFAULT,
    private bars: number = SPARKLINE_BARS_DEFAULT,
  ) {}

  /** Time covered by the whole retained history, in milliseconds. */
  get spanMs(): number {
    return this.barMs * this.bars;
  }

  /**
   * Re-applies bar width and bar count, discarding recorded history.
   * Existing buckets are keyed to the old width, so they cannot be reused.
   *
   * @param barMs Bar width in milliseconds.
   * @param bars Number of bars retained.
   * @returns Whether the geometry actually changed.
   */
  configure(barMs: number, bars: number): boolean {
    if (barMs === this.barMs && bars === this.bars) return false;
    this.barMs = barMs;
    this.bars = bars;
    this.reset();
    return true;
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

    const oldest = index - this.bars;
    for (const key of this.buckets.keys()) {
      if (key < oldest) this.buckets.delete(key);
    }
  }

  /**
   * Returns the completed bars covering the retained history, oldest first,
   * always `bars` entries long.
   *
   * Every bar is averaged over the full bar width, and buckets with no tokens
   * become zero bars so stalls read as gaps.
   *
   * @param now Current timestamp in milliseconds.
   */
  series(now: number): TokenBar[] {
    const current = Math.floor(now / this.barMs);
    const series: TokenBar[] = [];

    for (let offset = this.bars; offset >= 1; offset--) {
      const tokens = this.buckets.get(current - offset) ?? 0;
      series.push({ tokens, tps: (1000 * tokens) / this.barMs });
    }

    return series;
  }

  /**
   * Rescales every retained bucket, e.g. when an authoritative token count
   * reveals the local counter was off by a factor.
   *
   * History survives across turns, so an uncorrected stretch would sit next
   * to a corrected one on the same vertical scale and read as a real change in
   * throughput.
   *
   * @param factor Multiplier applied to each bucket's token count.
   */
  scale(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    for (const [index, tokens] of this.buckets) {
      this.buckets.set(index, tokens * factor);
    }
  }

  /** Discards all recorded buckets. */
  reset(): void {
    this.buckets = new Map();
  }
}
