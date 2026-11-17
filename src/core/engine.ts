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
import { SlidingWindow } from "./sliding-window";
import { TokenCalibration } from "./token-calibration";
import { TokenEstimator } from "./token-estimator";

/**
 * Relative disagreement between the local counter and an authoritative count
 * that is still treated as agreement. Below this the total is corrected but the
 * recorded history is left alone: rescaling by 1.01× is invisible, and skipping
 * it keeps a well-calibrated stream inert.
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
 * Some providers stream one token per delta and some pack twenty into one when
 * speculative decoding accepts a long run; some report cumulative usage on
 * every chunk, some only in the last, some never. No fixed counting rule is
 * right for all of them, and a settings key per provider is wrong until the
 * user diagnoses the wrongness and picks the lesser wrong option.
 *
 * So counting is layered and self-correcting: each delta is scored in proxy
 * units by `TokenEstimator` (how much text arrived), those units become tokens
 * through a ratio `TokenCalibration` learned from this provider's own earlier
 * counts, and whenever an authoritative count exists the total is snapped to it
 * with the recorded history scaled to match — so a correction moves the reading
 * and the total together instead of only the number.
 *
 * Degrades in the right order: no usage reported at all means calibrated text
 * estimation, late usage means one correction per turn, continuous usage means
 * an exact reading.
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
   * The estimator and the calibration map deliberately survive this call: the
   * settings menu invokes `initialize()` on every change, and neither is
   * configuration. An unrelated tweak should not forget what this endpoint's
   * tokens turned out to be worth.
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
   * it, is folded in afterwards so the total never drifts from what the provider
   * says it produced. `countStrategy` decides how the text is counted.
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
   * assistant message of a turn (the one after a tool call) restarts its count.
   * Without that boundary a smaller count reads as no progress, and the turn is
   * reconciled against the first message's total alone.
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
   * Records a batch of tokens, pushing a timestamped event for TPS calculation.
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
   * Scaling instead of replacing is what makes a correction honest: the reading
   * on screen and the total are derived from the same recorded history, so
   * replacing only the total leaves the status bar claiming a rate that no
   * longer corresponds to the tokens it is computed from. That is how a
   * five-times miscount used to surface — one rate held for the whole stream,
   * then a jump at the end.
   *
   * @param tokens The authoritative token count from the message end event.
   */
  reconcileTotal(tokens: number): void {
    // A count reported for a turn that never streamed cannot describe any
    // history this engine holds: the retained window belongs to an earlier one.
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
    this._tps = this._isStreaming
      ? this._slidingWindow.getTps(this.now())
      : this._tps * factor;
  }

  /**
   * Key for the ratio learned about what is being streamed to: a provider can
   * front different tokenizers, and a local server can be swapped under one id.
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
   * Learned ratios for every target seen this session — diagnostics and tests.
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
