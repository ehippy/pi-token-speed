/**
 * Matches the runs a tokenizer roughly charges one token for: a word
 * (letters/digits) or a single non-space, non-word character.
 */
const UNIT_REGEX = /\w+|[^\s\w]/g;

/**
 * Turns streamed text into "units": a dimensionless proxy for tokens that
 * answers the weaker, answerable question — *how much text arrived?* A
 * learned tokens-per-unit ratio (`TokenCalibration`) decides what a unit is
 * worth, so this class never has to know which tokenizer is in use.
 *
 * A non-empty delta is worth at least one unit, whitespace-only included: a
 * bare space is its own token in most BPE vocabularies, so scoring it zero
 * would undercount token-granular streams by a token per word. Non-Latin
 * scripts and long symbol runs score high against a real tokenizer; the
 * calibration absorbs that rather than this class trying to.
 */
export class TokenEstimator {
  /**
   * Scores a piece of streamed text.
   *
   * @param text The delta text (content, thinking, or tool-call arguments).
   * @returns Proxy units: 0 for empty text, otherwise at least 1.
   */
  units(text: string): number {
    if (!text) return 0;
    const runs = text.match(UNIT_REGEX)?.length ?? 0;
    return runs > 0 ? runs : 1;
  }
}
