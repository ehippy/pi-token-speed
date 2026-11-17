import { ScalarSettingsItem } from "./scalar";

/**
 * How the extension counts output tokens while a message streams.
 *
 * - `auto` (default): score each delta in proxy units from its text, scaled by
 *   a tokens-per-unit ratio learned from this provider's own counts. Needs no
 *   configuration on an endpoint that packs many tokens into one delta.
 * - `estimate`: the same text scoring with the ratio pinned to 1.
 * - `direct`: one token per delta, correct only where a delta really is one
 *   token — a server that batches (speculative decoding, chunk coalescing, a
 *   proxy merging SSE frames) is undercounted by its batch size, and the
 *   faster such a server runs the larger its batches get.
 *
 * Provider-reported usage layers on top of whichever is chosen:
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
