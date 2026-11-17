import { SPARKLINE_HISTORY_MS_DEFAULT } from "../settings/items/sparkline";

/**
 * Sticky vertical scale for the sparkline, in tokens per second.
 *
 * Tracks a high watermark that rises instantly and falls exponentially, the
 * way an audio peak-hold meter behaves. Scaling bars against the tallest bar
 * currently in view would re-normalize the whole graph the moment that bar
 * scrolls off the left edge, so every remaining bar jumps at once; holding the
 * peak and letting it relax instead keeps bar heights comparable while the
 * graph still zooms out smoothly once the stream slows down.
 *
 * Stateful by design: `update()` is called once per render with the current
 * clock, so decay is driven by the caller's time source and stays testable.
 */
export class PeakCeiling {
  private peak = 0;
  private lastUpdate?: number;

  constructor(private halfLifeMs: number = SPARKLINE_HISTORY_MS_DEFAULT) {}

  /** The current ceiling, without advancing decay. */
  get value(): number {
    return this.peak;
  }

  /**
   * Re-applies the decay half-life, forgetting the held peak when it changes.
   *
   * @param halfLifeMs Time for an unchallenged peak to fall to half its value.
   * @returns Whether the half-life actually changed.
   */
  configure(halfLifeMs: number): boolean {
    const next = halfLifeMs > 0 ? halfLifeMs : SPARKLINE_HISTORY_MS_DEFAULT;
    if (next === this.halfLifeMs) return false;
    this.halfLifeMs = next;
    this.reset();
    return true;
  }

  /**
   * Advances decay to `now` and folds in a new peak sample.
   *
   * The sample always wins immediately, so a fast response never lags; an
   * unchallenged peak decays with a half-life of `halfLifeMs`.
   *
   * @param now Current timestamp in milliseconds.
   * @param sample Highest rate in the bars about to be drawn.
   * @returns The ceiling to scale those bars against.
   */
  update(now: number, sample: number): number {
    const elapsed =
      this.lastUpdate === undefined ? 0 : Math.max(0, now - this.lastUpdate);
    this.lastUpdate = now;

    const decayed = this.peak * Math.pow(0.5, elapsed / this.halfLifeMs);
    this.peak = Math.max(sample, decayed);
    return this.peak;
  }

  /**
   * Rescales the held peak by `factor`.
   *
   * The peak is measured in tokens per second, so when a correction rescales
   * the bars it has to rescale the scale they are drawn against as well —
   * otherwise the same bars change height purely because a total was corrected.
   *
   * @param factor Multiplier applied to the held peak.
   */
  scale(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    this.peak *= factor;
  }

  /** Forgets the held peak. */
  reset(): void {
    this.peak = 0;
    this.lastUpdate = undefined;
  }
}
