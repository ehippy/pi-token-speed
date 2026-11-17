/** Ratio assumed before any stream has reported an authoritative count. */
export const NEUTRAL_TOKENS_PER_UNIT = 1;

/**
 * Bounds on a learned ratio. A word/punctuation proxy tracks a real tokenizer
 * to within a factor of two for any language a chat model is asked to write
 * in, so a ratio outside this range means the evidence is bad — a truncated
 * stream, usage reported for something other than what was counted — rather
 * than a tokenizer being exotic.
 */
export const MIN_TOKENS_PER_UNIT = 0.25;
export const MAX_TOKENS_PER_UNIT = 4;

/**
 * Tokens one stream may contribute as evidence: volume-weighted so a long
 * answer moves the ratio and an acknowledgement barely touches it, capped so
 * one generation cannot freeze it against everything that follows.
 */
const MAX_EVIDENCE_TOKENS = 8000;

/** A learned ratio plus how much authority sits behind it. */
interface CalibrationEntry {
  /** Tokens per estimator unit. */
  ratio: number;
  /** Accumulated evidence, in tokens (capped). */
  evidence: number;
}

/**
 * Learned tokens-per-unit ratios, keyed by what is generating the text.
 *
 * Providers differ in batching, in how their tokenizer charges for words
 * versus punctuation, and in whether reasoning counts toward the reported
 * total — three things that all show up as this one number. Instead of asking
 * for it in settings, every stream that ends with an authoritative count
 * contributes an observation (`authoritativeTokens / proxyUnits`) and the ratio
 * becomes the evidence-weighted mean of the observations so far.
 *
 * Session-scoped on purpose: a ratio describes a live endpoint, so writing it
 * to the settings file would outlive the server it describes.
 */
export class TokenCalibration {
  private readonly entries = new Map<string, CalibrationEntry>();

  /**
   * The ratio to apply to units for `key`, or neutral when uncalibrated.
   *
   * @param key Calibration key (see `calibrationKey`), undefined = neutral.
   */
  ratioFor(key: string | undefined): number {
    if (!key) return NEUTRAL_TOKENS_PER_UNIT;
    return this.entries.get(key)?.ratio ?? NEUTRAL_TOKENS_PER_UNIT;
  }

  /**
   * Records one authoritative measurement and folds it into the ratio.
   *
   * Ignored unless both sides are positive: zero units means nothing was
   * counted to compare against, zero tokens means nothing usable was reported.
   *
   * @param key Calibration key.
   * @param units Proxy units counted for the same span.
   * @param tokens Authoritative token count for that span.
   * @returns The ratio after the observation, or the previous one when the
   *   observation was ignored.
   */
  observe(key: string | undefined, units: number, tokens: number): number {
    if (!key || units <= 0 || tokens <= 0) {
      return this.ratioFor(key);
    }

    const observed = clampRatio(tokens / units);
    const weight = Math.min(tokens, MAX_EVIDENCE_TOKENS);
    const previous = this.entries.get(key);

    if (!previous) {
      this.entries.set(key, { ratio: observed, evidence: weight });
      return observed;
    }

    const total = previous.evidence + weight;
    this.entries.set(key, {
      ratio: (previous.ratio * previous.evidence + observed * weight) / total,
      evidence: total,
    });
    return this.ratioFor(key);
  }

  /** How much evidence backs each key — diagnostics and tests. */
  snapshot(): Record<string, { ratio: number; evidence: number }> {
    return Object.fromEntries(
      [...this.entries].map(([key, { ratio, evidence }]) => [
        key,
        { ratio, evidence },
      ]),
    );
  }

  /** Forgets every learned ratio. */
  reset(): void {
    this.entries.clear();
  }
}

/**
 * Forces a ratio into the plausible range.
 *
 * @param ratio Raw tokens-per-unit ratio.
 * @returns The clamped ratio.
 */
function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return NEUTRAL_TOKENS_PER_UNIT;
  return Math.min(MAX_TOKENS_PER_UNIT, Math.max(MIN_TOKENS_PER_UNIT, ratio));
}
