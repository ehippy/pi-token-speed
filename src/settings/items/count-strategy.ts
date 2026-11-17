import { ScalarSettingsItem } from "./scalar";

/**
 * How the extension counts output tokens while a message streams.
 *
 * - `auto` (default): score each delta in proxy units from its text and scale
 *   those units by a tokens-per-unit ratio learned from this provider's own
 *   counts during the session. Works on any endpoint without configuration,
 *   including servers that pack many tokens into one delta.
 * - `estimate`: use the raw text estimate, without learning anything.
 * - `direct`: count one token per delta, whatever the delta contains. Correct
 *   only for endpoints that really stream a token at a time; a server that
 *   batches tokens (speculative decoding, chunk coalescing, a proxy that
 *   merges SSE frames) is undercounted by its batch size, and the faster such a
 *   server goes the bigger its batches get, so the reading falls as the model
 *   speeds up.
 *
 * Provider-reported usage is layered on top of whichever strategy is chosen:
 * `useProviderTokens` decides whether it steers the live reading, and an
 * authoritative count always reconciles the total at end of turn.
 */
export type CountStrategy = "auto" | "estimate" | "direct";

export const COUNT_STRATEGY_DEFAULT: CountStrategy = "auto";

const COUNT_STRATEGY_LABELS: Record<CountStrategy, string> = {
  auto: "Adaptive (recommended)",
  estimate: "Estimate (text only)",
  direct: "Direct (one per delta)",
};

/**
 * Enum setting: how to count tokens during streaming.
 */
export class CountStrategySettingsItem extends ScalarSettingsItem<CountStrategy> {
  constructor() {
    super({
      id: "countStrategy",
      label: "Count strategy",
      description:
        "Adaptive counts text and learns the provider's tokens per unit; the others count raw text or one token per delta",
      default: COUNT_STRATEGY_DEFAULT,
      labels: COUNT_STRATEGY_LABELS,
    });
  }
}
