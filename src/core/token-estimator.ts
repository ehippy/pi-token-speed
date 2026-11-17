/**
 * Matches the runs a tokenizer roughly charges one token for: a word
 * (letters/digits) or a single non-space, non-word character.
 */
const UNIT_REGEX = /\w+|[^\s\w]/g;

/**
 * Turns streamed text into "units" — a dimensionless proxy for tokens.
 *
 * The proxy is deliberately not called a token count. Text-only estimation
 * can approximate a tokenizer but never reproduce it, so this class answers a
 * weaker, answerable question: *how much text arrived?* Multiplying the answer
 * by a learned tokens-per-unit ratio (`TokenCalibration`) is what produces a
 * token count, and the ratio absorbs the systematic error of whatever
 * tokenizer is on the other end.
 *
 * Rules that make the proxy well behaved:
 *
 * - One unit per word run and one per punctuation/symbol character, so prose,
 *   code and JSON tool arguments all score roughly proportionally to length.
 * - A non-empty delta is worth *at least* one unit, including whitespace-only
 *   deltas. Every delta a provider sends carries at least one token's worth of
 *   decoding, and a bare space is its own token in most BPE vocabularies —
 *   scoring it as zero would undercount token-granular streams by one token per
 *   word.
 * - An empty delta is worth nothing: keepalive and role-only chunks decode
 *   nothing.
 *
 * Known biases (absorbed by calibration, not by this class): non-Latin scripts
 * score one unit per character, and long symbol runs such as `====` score one
 * unit per character where a tokenizer usually merges them.
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
