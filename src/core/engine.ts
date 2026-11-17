import type { SettingsProvider, TokenSpeedConfig } from "../config/types";
import {
  COUNT_STRATEGY_DEFAULT,
  type CountStrategy,
} from "../settings/items/count-strategy";
import {
  END_TPS_BEHAVIOR_DEFAULT,
  type EndTpsBehavior,
} from "../settings/items/end-tps-behavior";
import { SLIDING_WINDOW_DEFAULT } from "../settings/items/sliding-window";
import { USE_PROVIDER_TOKENS_DEFAULT } from "../settings/items/use-provider-tokens";
import { TokenBars, type SparklineView } from "../sparkline/bars";
import { PeakCeiling } from "../sparkline/ceiling";
import { SlidingWindow } from "./sliding-window";
import { TokenCalibration } from "./token-calibration";
import { TokenEstimator } from "./token-estimator";

/**
 * Relative disagreement between the local counter and an authoritative count
 * that is still treated as agreement.
 *
 * Below this, the total is corrected but the recorded history is left alone:
 * rescaling bars by 1.00x or 1.01x is invisible, and skipping it keeps the
 * steady state of a well-calibrated stream completely inert.
 */
const RESYNC_TOLERANCE = 0.02;

/** What a single delta contributed, before and after calibration. */
interface DeltaCount {
  /** Tokens to record for the delta. */
  tokens: number;
  /** Proxy units the delta scored, the quantity calibration is learned on. */
  units: number;
}

/**
 * Measures output throughput of a streaming model.
 *
 * The hard part is not the arithmetic, it is knowing how many tokens arrived.
 * Providers disagree about that in every way that matters to a rate: some
 * stream one token per delta, some pack twenty into a delta when speculative
 * decoding accepts a long run; some report cumulative usage on every chunk,
 * some only in the last one, some never. A single counting rule cannot be right
 * for all of them, which is why a fixed rule plus a settings key per provider
 * is a poor answer — the number is wrong until the user diagnoses the wrongness
 * and picks the lesser wrong option.
 *
 * So counting is layered and self-correcting instead:
 *
 * 1. **Estimate.** Each delta is scored in proxy units by `TokenEstimator`:
 *    how much text arrived. This works for every provider, always, and needs
 *    to know nothing about the endpoint.
 * 2. **Calibrate.** Proxy units become tokens through a learned tokens-per-unit
 *    ratio per provider+model (`TokenCalibration`), learned from counts the
 *    provider itself reported earlier in the session.
 * 3. **Resync.** Whenever an authoritative count is available — mid-stream for
 *    providers that report usage as they go, at end of turn for the rest — the
 *    total is snapped to it and the recorded history is *scaled* to match, so a
 *    correction moves the reading and the graph together instead of only the
 *    number.
 *
 * The result degrades gracefully in exactly the right order: an endpoint that
 * reports no usage at all is measured by calibrated text estimation, an
 * endpoint that reports it late is corrected once per turn, and an endpoint
 * that reports it continuously is measured exactly.
 */
export class TokenSpeedEngine {
  private _isStreaming = false;
  private _isPaused = false;

  private _tokenCount = 0;
  private _startTime = 0;
  private _endTime = 0;
  /** Whether a stream has ever started, so `_startTime` need not double as a sentinel. */
  private _started = false;

  private _ttftStart = 0;
  private _ttftEnd = 0;

  private _startPause = 0;
  private _pausedMs = 0;

  private _tps = 0;

  /** Proxy units counted for the current stream. */
  private _proxyUnits = 0;

  /** Authoritative output tokens accounted for before this message. */
  private _priorMessages = 0;
  /** Provider-reported cumulative output tokens for the current message. */
  private _messageUsage = 0;
  /** Authoritative output tokens for the turn as a whole. */
  private _authoritative = 0;
  /** Whether a stream has run since the last reconciliation. */
  private _streamedThisTurn = false;

  private _slidingWindow: SlidingWindow;
  private _bars = new TokenBars();
  private _ceiling = new PeakCeiling();
  private readonly _estimator = new TokenEstimator();
  private readonly _calibration = new TokenCalibration();

  private _useProviderTokens = USE_PROVIDER_TOKENS_DEFAULT;
  private _countStrategy: CountStrategy = COUNT_STRATEGY_DEFAULT;
  private _endTpsBehavior: EndTpsBehavior = END_TPS_BEHAVIOR_DEFAULT;
  private _providerId: string | undefined;
  private _modelId: string | undefined;

  constructor(private readonly settings: SettingsProvider) {
    this._slidingWindow = new SlidingWindow(SLIDING_WINDOW_DEFAULT);
  }

  /**
   * Loads configuration.
   * Must be called after `settings.initialize()`.
   *
   * The estimator, the calibration map and the sparkline history deliberately
   * survive this call: the settings menu invokes `initialize()` on every change,
   * and none of those three are configuration. Unrelated tweaks should not blank
   * a graph mid-session or forget what this endpoint's tokens turned out to be
   * worth; bars age out of the window on their own, and `configure()` clears them
   * when the geometry makes old buckets moot.
   */
  initialize(): void {
    this._providerId = undefined;
    this._modelId = undefined;
    this.applyConfig(this.settings.getConfig());
  }

  /**
   * Re-applies target-dependent configuration for the given provider and model.
   *
   * Resolves the effective config (base + provider override block) and refreshes
   * the engine-side fields (slidingWindow, useProviderTokens, countStrategy,
   * endTpsBehavior). A no-op when the target is unchanged or when a stream is
   * active — mid-stream switches are picked up at the next stream start instead,
   * so the sliding window is never reset while a stream is in flight.
   *
   * @param providerId The pi ProviderId (e.g. "anthropic"), or undefined
   *   when no model is active (base config applies).
   * @param modelId The model id being streamed to, used only to key learned
   *   calibration, since a provider can front several tokenizers.
   */
  applyProvider(providerId?: string, modelId?: string): void {
    if (this._isStreaming) return;
    if (providerId === this._providerId && modelId === this._modelId) return;
    this._providerId = providerId;
    this._modelId = modelId;
    this.applyConfig(this.settings.resolveConfig(providerId));
  }

  /**
   * Applies engine-side fields from a resolved config (fresh sliding
   * window, counting strategy, provider-token usage, end-of-stream
   * behavior). Shared by `initialize` and `applyProvider`.
   */
  private applyConfig(config: TokenSpeedConfig): void {
    this._slidingWindow = new SlidingWindow(config.slidingWindow);
    this._bars.configure(config.sparklineBarMs, config.sparklineBars);
    // The held peak relaxes on the same clock the visible history scrolls past
    // on, so a burst fades from the scale as it fades from the graph.
    this._ceiling.configure(this._bars.spanMs);
    this._countStrategy = config.countStrategy;
    this._useProviderTokens = config.useProviderTokens;
    this._endTpsBehavior = config.endTpsBehavior;
  }

  // ── counting ────────────────────────────────────────────────────────────

  /**
   * Records a streaming delta (content, thinking, or tool-call arguments).
   *
   * The delta is always counted — text is the only signal a batched server
   * gives — and a provider-reported cumulative count, if one rode along with
   * the delta, is folded in afterwards so the total never drifts from what the
   * provider says it has produced.
   *
   * Counting behavior comes from `countStrategy`:
   * - `auto` (default): proxy units scaled by the learned ratio for this
   *   provider and model
   * - `estimate`: proxy units as they come off the text, uncalibrated
   * - `direct`: one token per delta, whatever it contains (legacy)
   *
   * @param delta The delta string (text, thinking, or tool-call).
   * @param usageOutput Provider-reported cumulative output-token count for the
   *   current message (optional).
   */
  recordDelta(delta: string, usageOutput?: number): void {
    if (!this._isStreaming) return;
    if (this._isPaused) this.resume();

    const { tokens, units } = this.countDelta(delta);
    this.recordTokens(tokens, units);
    this.accountUsage(usageOutput);
  }

  /**
   * Marks the start of a new assistant message within the same turn.
   *
   * Providers count output tokens cumulatively *per message*, so the second
   * assistant message of a turn (the one after a tool call) starts its count
   * over. Without that boundary, a smaller count reads as no progress and the
   * turn gets reconciled against the first message's total alone.
   */
  beginMessage(): void {
    this._priorMessages = this._authoritative;
    this._messageUsage = 0;
  }

  /**
   * Scores one delta under the active counting strategy.
   *
   * @param delta The delta text.
   * @returns Tokens to record, and the proxy units they derive from.
   */
  private countDelta(delta: string): DeltaCount {
    const units = this._estimator.units(delta);

    switch (this._countStrategy) {
      case "direct":
        // Legacy semantics, kept for endpoints that really do emit one token
        // per delta: the delta *is* the token, even when it carries no text.
        return { tokens: 1, units };
      case "estimate":
        return { tokens: units, units };
      case "auto":
      default:
        return {
          tokens: units * this._calibration.ratioFor(this.calibrationKey()),
          units,
        };
    }
  }

  /**
   * Records a batch of tokens, pushing a timestamped event for TPS calculation
   * and adding the batch to the sparkline bucket covering `now`.
   *
   * @param tokens Tokens recorded.
   * @param units Proxy units those tokens were derived from.
   */
  private recordTokens(tokens: number, units: number): void {
    if (!this._isStreaming || tokens <= 0) return;

    const now = this.now();
    this._tokenCount += tokens;
    this._proxyUnits += units;
    this._slidingWindow.record(tokens, now);
    this._bars.add(tokens, now);
    this._tps = this._slidingWindow.getTps(now);
  }

  /**
   * Folds a provider-reported cumulative output count into the turn total.
   *
   * Counts that do not advance are ignored: a provider may repeat a count, or
   * report zero for every chunk until the last one.
   *
   * @param usageOutput Cumulative output tokens for the current message.
   */
  private accountUsage(usageOutput?: number): void {
    if (usageOutput === undefined || usageOutput <= this._messageUsage) return;

    this._messageUsage = usageOutput;
    this._authoritative = this._priorMessages + usageOutput;

    if (this._useProviderTokens) this.resync(this._authoritative, false);
  }

  /**
   * Snaps the total to an authoritative count and scales the recorded history
   * by the same factor.
   *
   * Scaling instead of replacing is what makes a correction honest. The total
   * and the reading on screen are derived from the same recorded history, so
   * replacing only the total leaves the status bar claiming a rate that no
   * longer corresponds to any of the tokens it is computed from — which is how
   * a five-times miscount surfaced as one rate held for a whole stream and then
   * a jump at the end.
   *
   * A count reported for a turn that never streamed is ignored: the retained
   * history belongs to an earlier stream, and rescaling it by this turn's usage
   * would rewrite bars that were drawn from different tokens.
   *
   * @param tokens The authoritative token count from the message end event.
   */
  reconcileTotal(tokens: number): void {
    if (tokens <= 0 || !this._streamedThisTurn) return;
    // One correction per stream: a second report for the same turn would scale
    // history that has already been corrected.
    this._streamedThisTurn = false;
    this._authoritative = tokens;
    // `direct` counts deltas, not text, so its counts say nothing useful about
    // what this provider's tokens are worth in estimator units.
    this.resync(tokens, this._countStrategy !== "direct");
  }

  /**
   * Corrects the running total to `total`, rescaling history when the
   * disagreement is visible and optionally learning from it.
   *
   * @param total Authoritative token count for the turn so far.
   * @param calibrate Whether this is a whole-stream measurement worth learning
   *   a tokens-per-unit ratio from (end of stream: yes; a mid-stream chunk: no,
   *   it would count the same evidence repeatedly).
   */
  private resync(total: number, calibrate: boolean): void {
    const counted = this._tokenCount;
    if (total <= 0 || counted <= 0) return;

    if (calibrate) {
      this._calibration.observe(this.calibrationKey(), this._proxyUnits, total);
    }

    const factor = total / counted;
    this._tokenCount = total;
    if (Math.abs(factor - 1) <= RESYNC_TOLERANCE) return;

    this._slidingWindow.scale(factor);
    this._bars.scale(factor);
    this._ceiling.scale(factor);
    this._tps = this._isStreaming
      ? this._slidingWindow.getTps(this.now())
      : this._tps * factor;
  }

  /**
   * Key for the ratio learned about the thing currently being streamed to:
   * a provider can front different tokenizers, and a local server can be
   * swapped under one model id.
   *
   * @returns The `provider/model` calibration key.
   */
  private calibrationKey(): string {
    return `${this._providerId ?? "unknown"}/${this._modelId ?? "unknown"}`;
  }

  // ── readings ────────────────────────────────────────────────────────────

  /**
   * Whether a streaming session is currently active
   */
  get isStreaming() {
    return this._isStreaming;
  }

  /**
   * Total number of output tokens recorded since stream start, after the most
   * recent authoritative correction.
   */
  get tokenCount() {
    return Math.round(this._tokenCount);
  }

  /**
   * Returns elapsed milliseconds since stream start (0 if not started)
   */
  get elapsedMs(): number {
    if (!this._started) return 0;
    if (this.isStreaming) return this.now() - this._startTime - this._pausedMs;
    return this._endTime - this._startTime - this._pausedMs;
  }

  /** Returns elapsed seconds since stream start (0 if not started). */
  get elapsedSeconds(): number {
    return this.elapsedMs / 1000;
  }

  /**
   * Returns the current time in milliseconds. Overridable for testing.
   */
  protected now(): number {
    return Date.now();
  }

  /**
   * Returns tokens-per-second based on a time-based sliding window while streaming.
   * When streaming has finished, behavior depends on `endTpsBehavior`:
   * - `"average"` (default): returns the overall average TPS for consistency with stats.
   * - `"last"`: returns the last sliding window measurement.
   */
  get tps(): number {
    if (this._isStreaming) {
      // Read the window at the current instant, not at the last delta's. A rate
      // that only changes when text arrives freezes through every gap, which is
      // what a slow server spends most of its time showing: the number on
      // screen belongs to the moment the last chunk landed. Held while paused,
      // since a pause is not time the model was asked to account for.
      return this._isPaused
        ? this._tps
        : this._slidingWindow.getTps(this.now());
    }
    if (this._endTpsBehavior === "last") return this._tps;
    return this.tpsAvg;
  }

  /**
   * Returns the overall average tokens-per-second for the entire stream.
   * Computed as total tokens / elapsed seconds. Returns 0 if no time has elapsed.
   */
  get tpsAvg(): number {
    if (this.elapsedSeconds <= 0) return 0;
    return this._tokenCount / this.elapsedSeconds;
  }

  /**
   * Returns the sparkline history plus the vertical scale to draw it against.
   *
   * Each bar averages the tokens recorded in its own completed slot, so the
   * shape absorbs per-delta fluctuation and stalls appear as empty bars.
   * History is kept across turns; only a bar-geometry change clears it.
   *
   * Called once per render: the ceiling is the held peak advanced to the
   * current clock, so it jumps with new highs and then decays rather than
   * snapping when the tallest bar scrolls out of view.
   */
  get sparklineView(): SparklineView {
    const now = this.now();
    const bars = this._bars.series(now);
    const observed = bars.reduce((max, bar) => Math.max(max, bar.tps), 0);

    return { bars, ceiling: this._ceiling.update(now, observed) };
  }

  /**
   * Returns time to first token in milliseconds
   */
  get ttft(): number {
    return Math.max(this._ttftEnd - this._ttftStart, 0);
  }

  /**
   * Tokens-per-unit ratio currently applied for the active provider and model.
   * 1 means the endpoint is still being measured by text estimation alone.
   */
  get tokensPerUnit(): number {
    return this._calibration.ratioFor(this.calibrationKey());
  }

  /**
   * Learned ratios for every target seen this session, for `/tps` diagnostics.
   */
  get calibration(): Record<string, { ratio: number; evidence: number }> {
    return this._calibration.snapshot();
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  /**
   * Starts a new streaming session.
   */
  start(): void {
    if (this._isStreaming) return;

    this._tokenCount = 0;
    this._isStreaming = true;
    this._startTime = this.now();
    this._endTime = this.now();
    this._started = true;
    this._slidingWindow.reset();
    this._proxyUnits = 0;
    this._priorMessages = 0;
    this._messageUsage = 0;
    this._authoritative = 0;
    this._streamedThisTurn = true;
    this._tps = 0;
    this._pausedMs = 0;
    // A previous stream can only have ended paused if `stop()` did not run, so
    // carrying the flag over would bill that gap to this stream's clock.
    this._isPaused = false;
  }

  /**
   * Records the start timestamp for TTFT measurement.
   */
  startTTFT(): void {
    this._ttftStart = this.now();
    this._ttftEnd = 0;
  }

  /**
   * Records the end timestamp for TTFT measurement.
   * Only captures once per stream (guarded by _ttftEnd).
   */
  stopTTFT(): void {
    if (this._ttftEnd !== 0) return;
    this._ttftEnd = this.now();
  }

  /**
   * Stops streaming.
   */
  stop(): void {
    // A stream that ends while paused — the turn ended on a tool call, and the
    // tool ran without another delta arriving to resume the clock — must not
    // bill that execution to the model: the clock stopped when the model did.
    this._endTime = this._isPaused ? this._startPause : this.now();
    this._isStreaming = false;
    this._isPaused = false;
    this._slidingWindow.reset();
  }

  /**
   * Pauses the timer. Call before a tool call ends to exclude its execution time.
   * The next `recordDelta` will call `resume()`.
   */
  pause(): void {
    this._isPaused = true;
    this._startPause = this.now();
  }

  /**
   * Resumes the timer, updating the paused time.
   */
  private resume(): void {
    this._isPaused = false;
    this._pausedMs += this.now() - this._startPause;
  }
}
