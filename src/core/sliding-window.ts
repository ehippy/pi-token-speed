import { COMPACTION_THRESHOLD, MIN_SLIDING_WINDOW } from "../config/constants";

/** Tokens observed at a point in time. */
interface TokenEvent {
  /** Timestamp in milliseconds, on the caller's clock. */
  time: number;
  /** Tokens recorded at that instant. */
  tokens: number;
}

/**
 * Time-based sliding window for calculating tokens-per-second.
 *
 * Records timestamped token events and reports the rate over the most recent
 * `windowMs`. Compacts old events periodically to prevent unbounded memory
 * growth.
 *
 * Two properties make the rate trustworthy at both speed extremes:
 *
 * **The window is the measurement interval.** The denominator is the window
 * itself, truncated only while the stream is younger than the window. The
 * alternative — dividing by `now - firstTokenInWindow` — turns any gap in
 * arrivals into a rate multiplier: a slow model that streams one token per
 * second reads 2 tok/s when the last token happened to land 500ms ago, and a
 * server that flushes a buffered batch reads thousands. Those spikes are
 * artifacts of *when* chunks crossed the network, not of decoding speed, and
 * they were the dominant noise on fast local servers. Trading them for a
 * window-average means a burst shorter than the window reads as the window's
 * average rate — which is what a window is for. The per-instant shape is not
 * lost: the sparkline histogram keeps it.
 *
 * **One clock.** Timestamps come from the caller, so the window, the sparkline
 * buckets and the elapsed-time average all age at the same rate, and tests can
 * drive time directly instead of patching `Date.now()`.
 */
export class SlidingWindow {
  private readonly events: TokenEvent[] = [];
  private windowStartIndex = 0;

  /** Time of the first event recorded since the last `reset()`. */
  private firstTime?: number;

  constructor(private readonly windowMs: number) {}

  /**
   * Records a batch of tokens at `now`.
   *
   * Compacts old events when the dead prefix reaches the compaction threshold.
   *
   * @param tokens Tokens recorded.
   * @param now Timestamp on the caller's clock, in milliseconds.
   */
  record(tokens: number, now: number): void {
    this.events.push({ time: now, tokens });
    this.firstTime ??= now;

    if (this.windowStartIndex >= COMPACTION_THRESHOLD) {
      this.compact();
    }
  }

  /**
   * Tokens per second over the window, or 0 when the window holds no tokens.
   *
   * @param now Current timestamp in milliseconds, on the same clock as
   *   the timestamps passed to `record()`.
   * @returns Tokens per second, or 0 if the window is empty.
   */
  getTps(now: number): number {
    if (this.events.length === 0) return 0;

    const windowStart = now - this.windowMs;

    // Advance past events older than the window
    while (
      this.windowStartIndex < this.events.length &&
      this.events[this.windowStartIndex].time < windowStart
    ) {
      this.windowStartIndex++;
    }

    if (this.windowStartIndex >= this.events.length) return 0;

    // Sum tokens in the window
    let windowTokenCount = 0;
    for (let i = this.windowStartIndex; i < this.events.length; i++) {
      windowTokenCount += this.events[i].tokens;
    }

    if (windowTokenCount === 0) return 0;

    // Measure over the window, but never over time that predates the stream:
    // the first 200 tokens of a stream cannot evidence more than their own
    // elapsed rate. `MIN_SLIDING_WINDOW` floors the interval so the first
    // flush of a fast server, which may land inside a single millisecond,
    // does not read as an absurd rate before the window has anything to
    // average over.
    const spanStart = Math.max(windowStart, this.firstTime ?? windowStart);
    const floor = Math.min(MIN_SLIDING_WINDOW, this.windowMs);
    const span = Math.max(now - spanStart, floor);

    return (1000 * windowTokenCount) / span;
  }

  /**
   * Rescales every recorded batch, e.g. when an authoritative count reveals
   * the local counter was off by a factor.
   *
   * Scaling rather than discarding: the window holds the measurement currently
   * on screen, so a correction has to move it with the total it is derived
   * from, or the reading and the token count disagree.
   *
   * @param factor Multiplier applied to each batch's token count.
   */
  scale(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    for (const event of this.events) {
      event.tokens *= factor;
    }
  }

  /**
   * Removes the dead prefix of the events array to free memory.
   * Called periodically when `windowStartIndex` reaches the compaction threshold.
   */
  private compact(): void {
    if (this.windowStartIndex === 0) return;
    this.events.splice(0, this.windowStartIndex);
    this.windowStartIndex = 0;
  }

  /**
   * Resets the window, discarding all recorded events.
   */
  reset(): void {
    this.events.length = 0;
    this.windowStartIndex = 0;
    this.firstTime = undefined;
  }
}
