# pi-token-speed

A [Pi Coding Agent](https://pi.dev/) extension that displays real-time **tokens-per-second (TPS)** performance metrics in the status bar while the AI is streaming responses.

## Features

- **Real-time TPS tracking** — measures token throughput as the assistant generates text and thinking content
- **Time-to-first-token (TTFT)** — measures latency from user message to the first token being generated
- **Configurable sliding window** — adjust the window size to suit your server speed (default: 1s)
- **Color-coded speed indicators** — visual feedback based on performance thresholds
- **Configurable update interval** — throttle status bar updates to reduce visual flickering
- **Adaptive token counting** — scores what arrived instead of counting chunks, and learns what a delta is worth on each endpoint
- **Provider-reported counting** — opt in to using provider-reported counts (e.g. Anthropic, OpenAI) instead of the extension's own counter
- **Per-provider overrides** — different thresholds, display mode, etc. per provider (e.g. `anthropic` vs `openai`)
- **Fully configurable** — customize display, thresholds and colors via `~/.pi/agent/settings.json`

## Speed Tiers

| Tier       | TPS   | Color              |
| ---------- | ----- | ------------------ |
| 🟥 Slow    | 0–15  | `#ff4444` (red)    |
| 🟨 Medium  | 15–30 | `#ffaa00` (orange) |
| 🟩 Fast    | 30–45 | `#00ff88` (green)  |
| 🟦 Blazing | 45+   | `#44ddff` (cyan)   |

## Installation

This package is a Pi extension. Install it with

```bash
npm install pi-token-speed
```

or

```bash
pi install https://github.com/gsanhueza/pi-token-speed
```

## Configuration

You can customize the display, speed thresholds and colors by adding a `tokenSpeed` section to your `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "thresholds": {
      "slow": 0,
      "medium": 15,
      "fast": 30,
      "blazing": 45
    },
    "colors": {
      "slow": "#ff4444",
      "medium": "#ffaa00",
      "fast": "#00ff88",
      "blazing": "#44ddff"
    },
    "display": "tps",
    "useProviderTokens": false,
    "countStrategy": "auto",
    "endTpsBehavior": "average",
    "icon": "⚡",
    "prefix": "TPS",
    "slidingWindow": 1000,
    "updateInterval": 0,
    "formatDuration": false,
    "suffixTheme": ""
  }
}
```

All keys are optional.

### Provider Overrides

Different providers stream at very different speeds and report tokens differently. The optional `providerOverrides` key lets you define per-provider configuration blocks with the exact same schema as the base config, applied whenever the active model's provider matches:

```json
{
  "tokenSpeed": {
    "thresholds": {
      "slow": 0,
      "medium": 15,
      "fast": 30,
      "blazing": 45
    },
    "display": "tps",
    "useProviderTokens": false,
    "countStrategy": "auto",
    "displayColors": {
      "count": "#00ff88",
      "elapsed": "#ffaa00",
      "ttft": "#44ddff"
    },
    "providerOverrides": {
      "anthropic": {
        "thresholds": {
          "slow": 0,
          "medium": 30,
          "fast": 60,
          "blazing": 90
        },
        "display": "ttft",
        "useProviderTokens": true,
        "countStrategy": "estimate"
      }
    }
  }
}
```

Keys are matched against the model's provider id (e.g. `anthropic`, `openai`, `google`, `github-copilot`). Override blocks may be **partial**: any key you omit falls back to the base config, and `thresholds`/`colors` merge per-tier (an override specifying only `thresholds.fast` doesn't wipe the sibling tiers). Invalid keys are dropped with a warning at session start, falling back to base.

Resolution timing per key group:

- **Renderer-side** keys (`display`, `icon`, `thresholds`, `colors`, `updateInterval`) apply as soon as the provider changes.
- **Engine-side** keys (`slidingWindow`, `useProviderTokens`, `countStrategy`, `endTpsBehavior`) apply at the next stream start, so the current measurement is never skewed mid-stream.

You can also manage overrides interactively with `/tps overrides` (see [Commands](#commands)).

### Configuration Validation

Invalid configuration values are automatically corrected to their defaults. A warning notification is displayed in the Pi status bar at session start listing any corrections made. The `slidingWindow` value is also clamped between `100ms` and `30000ms` (30s).

### Configuration Options

| Option               | Type                           | Default     | Description                                                                                         |
| -------------------- | ------------------------------ | ----------- | --------------------------------------------------------------------------------------------------- |
| `thresholds.slow`    | number                         | `0`         | Minimum TPS threshold ("slow")                                                                      |
| `thresholds.medium`  | number                         | `15`        | TPS above this is "medium"                                                                          |
| `thresholds.fast`    | number                         | `30`        | TPS above this is "fast"                                                                            |
| `thresholds.blazing` | number                         | `45`        | TPS above this is "blazing"                                                                         |
| `colors.slow`        | string                         | `"#ff4444"` | Color for slow tier                                                                                 |
| `colors.medium`      | string                         | `"#ffaa00"` | Color for medium tier                                                                               |
| `colors.fast`        | string                         | `"#00ff88"` | Color for fast tier                                                                                 |
| `colors.blazing`     | string                         | `"#44ddff"` | Color for blazing tier                                                                              |
| `slidingWindow`      | number                         | `1000`      | Sliding window duration in ms                                                                       |
| `display`            | `tps`, `ttft`, `stats`, `full` | `tps`       | Display mode (see [Display Modes](#display-modes))                                                  |
| `useProviderTokens`  | boolean                        | `false`     | Opt-in: use provider-reported count instead of the extension one                                    |
| `countStrategy`      | `auto`, `estimate`, `direct`   | `auto`      | Token counting strategy used by the extension's own counter (see [Count Strategy](#count-strategy)) |
| `endTpsBehavior`     | `average`, `last`              | `average`   | What to show after streaming ends                                                                   |
| `icon`               | string                         | `"⚡"`      | Icon shown before the prefix label in the status bar                                                |
| `prefix`             | string                         | `"TPS"`     | Prefix label shown before the measurement                                                           |
| `updateInterval`     | number                         | `0`         | Status bar update interval in ms (0 = every delta)                                                  |
| `formatDuration`     | boolean                        | `false`     | Show elapsed time in human-readable units (see [Duration Formatting](#duration-formatting))         |
| `suffixTheme`        | `""`, `"dim"`, `"muted"`       | `""`        | Style for uncolored suffix parts (empty, dim, or muted)                                             |
| `displayColors`      | object                         | `{}`        | Hex colors for the suffix parts (see [Display Color Customization](#display-color-customization))   |
| `providerOverrides`  | object                         | `{}`        | Per-provider config overrides (see [Provider Overrides](#provider-overrides))                       |

### Interactive Menu

A small interactive menu is available when running `/tps` in the editor, where you can adjust:

- **Display mode** — what to show in the status bar
- **Status icon** — choose the icon shown before the prefix label (`⚡`, `🔥`, `💨`, `🚀`, or none)
- **Status prefix** — customize the label before the measurement (`"TPS"`, `"Speed"`, or none)
- **Status update interval** — throttle status bar updates (see [Status Update Interval](#status-update-interval))
- **Use provider tokens** — use provider-reported counts instead of the extension's counter
- **Count strategy** — how the extension counts tokens (`estimate` or `direct`)
- **Sliding window** — time window for TPS calculation (see [Sliding Window](#sliding-window))
- **End-of-stream TPS** — what to show after streaming ends (`average` or `last`)
- **Format duration** — show elapsed time in human-readable units (see [Duration Formatting](#duration-formatting))
- **Thresholds** — customize the TPS threshold values for each tier (see [Threshold Customization](#threshold-customization))
- **Colors** — customize the hex color for each TPS tier (see [Color Customization](#color-customization))
- **Display colors** — customize the hex color for the suffix parts (count, elapsed, ttft) (see [Display Color Customization](#display-color-customization))
- **Suffix theming** — choose how uncolored suffix parts are styled (empty, dim, or muted) (see [Suffix Theming](#suffix-theming))

Per-provider overrides are managed separately via `/tps overrides` (see [Provider Overrides](#provider-overrides)).

### Sliding Window

The sliding window determines how much recent activity is used to calculate TPS. A larger window produces smoother readings at the cost of responsiveness; a smaller window reacts faster but is noisier.

**The window is the measurement interval.** Tokens are summed over the last `slidingWindow` milliseconds and divided by that interval — not by the span between the first and last arrival inside it. Measuring the span instead makes a quiet stretch inside the window act as a divisor:

```
window 1000ms, reading taken at t=1150ms
arrivals:  40 tokens at t=0   40 at t=100   10 at t=1100   10 at t=1150
in window: the last two, 20 tokens

measured over the window            →  20 tok/s
measured over the arrivals' own span → 200 tok/s   (the 100ms floor)
```

Both numbers describe when bytes crossed the network; only the first describes how fast the model decoded. A window that stays busy is unaffected — the two rules agree whenever arrivals span the window.

**A buffered flush is still attributed to its silence.** When everything in the window arrived at one instant after a quieter period, the interval extends back to the previous event, so a proxy that buffers for 5s and delivers 300 tokens reads ~60 tok/s rather than 300 for one refresh. This is deliberately limited to a single instant: applied to sparse arrivals as well, the same rule inflated the rate instead of deflating it.

| Server speed        | Recommended window | Why                                                       |
| ------------------- | ------------------ | --------------------------------------------------------- |
| Fast (30+ tok/s)    | `1000` (default)   | Plenty of tokens in the window — accurate and responsive  |
| Medium (5–30 tok/s) | `1000`–`3000`      | Enough tokens for stable readings                         |
| Slow (< 5 tok/s)    | `5000`–`15000`     | Captures more tokens, avoiding spiky or unreliable values |

For example, if your server streams at ~1 tok/s, a 10-second window gives ~10 tokens per window — enough for a reasonable calculation:

```json
{
  "tokenSpeed": {
    "slidingWindow": 10000
  }
}
```

### Provider Token Counts

By default this extension counts output itself — the same engine behind `countStrategy`. You can opt in to the provider's own reported counts:

| Value             | Behavior                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `false` (default) | Use this extension's counter for the live reading                                               |
| `true`            | Use the provider's reported counts as they arrive; fall back to `countStrategy` between reports |

Provider reports differ more than users expect:

| Provider behavior                                                         | Effect with `useProviderTokens: true`                                                                          |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Cumulative usage on every chunk (some OpenAI-compatible servers)          | Exact live counts                                                                                              |
| Usage only in the terminal chunk (LiteLLM in front of many local servers) | Nothing to use while streaming, so the reading comes from `countStrategy` and is corrected once at end of turn |
| No usage at all                                                           | Same as `false`                                                                                                |

Whichever way the live reading is produced, an authoritative count is always reconciled at end of turn (see [Reconciliation](#reconciliation)) — the total and the average are the provider's numbers.

### Count Strategy

When `useProviderTokens` is `false` (default) or when the provider doesn't report counts, the `countStrategy` determines how the extension's own counter works:

| Strategy         | Behavior                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `auto` (default) | Score each delta in proxy units from its text, scaled by a learned tokens-per-unit ratio |
| `estimate`       | Score each delta in proxy units, without learning anything                               |
| `direct`         | Count one token per delta, whatever the delta contains                                   |

**Why `auto` is the default.** `direct` assumes one delta is one token. Servers break that assumption constantly: speculative decoding (multi-token prediction) accepts a run of tokens per step, proxies merge SSE frames, and some servers simply batch flush. When they do, `direct` undercounts by the batch size — and the _faster_ such a server runs, the larger its batches get, so the reading falls as the model speeds up. Measured against `qwen-flash-bebop` (LiteLLM → MTPLX): 15.4 tokens per delta at 137 tok/s, 20.7 tokens per delta at 190 tok/s, and a status bar pinned at ~9 tok/s for both.

`auto` counts what arrived instead of counting chunks. Each delta is scored in units — one per word run and one per symbol, and at least one for any non-empty delta — and units are converted to tokens by a ratio learned from the provider's own counts (see [Token Calibration](#token-calibration)). No configuration is needed to be right on a server that batches, one that streams a token at a time, or one that reports no usage at all.

`estimate` is `auto` without learning: the same text scoring, ratio pinned to 1. Use it if you want a count that never depends on what earlier turns reported.

`direct` is kept for endpoints that genuinely emit one token per delta, where it is exactly right and needs no text at all.

> **Note:** All assistant tool-call deltas are counted under every strategy — the model generates every tool's arguments during decoding, so they all consume output tokens. Tool execution time is excluded via the timer-pause mechanism.

### Token Calibration

Text scoring can approximate a tokenizer but never reproduce one, so the extension measures the gap instead of guessing at it. Every stream that ends with an authoritative count contributes one observation — `reported tokens / units counted` — and the ratio for that provider and model becomes the evidence-weighted mean of the observations taken so far.

What that buys you:

- **First turn on a new endpoint:** measured by text alone, so close rather than exact. Replaying two real 1200-token generations from a server that packs 15–17 tokens into every delta, at the default 1 s window: mean absolute error 6.4% on prose (mean reading 133.0 tok/s against a true 134.6) and 17.9% on code (173.7 against 157.1 — the text score runs about 5% rich on that code and the window's opening truncation adds the rest). `direct` on the same streams reads 9.3 and 9.5 tok/s: 93% error, because it measures the delta rate rather than the token rate. Widening `slidingWindow` trades reaction for accuracy — at 5 s the two figures become 4.8% and 10.2%.
- **Later turns:** as accurate as that provider's own accounting, because it has already told you what its tokens were worth. The ratio is keyed on provider _and_ model, since one LiteLLM endpoint can front several tokenizers.
- **End of every turn:** exact. The provider's reported count becomes the total and the history is scaled to match (see [Reconciliation](#reconciliation)), so whatever error the live reading carried is gone by the time the turn closes.
- **Swapped servers:** a ratio describes a live endpoint, so it lives in memory for the session and is never written to your settings file.

The ratio is bounded to 0.25–4 tokens per unit: outside that range the evidence is bad (a truncated stream, usage reported for something other than what was counted) rather than the tokenizer being exotic.

To see it working, watch the reading stop jumping at end of turn. Corrections are applied while the correction is still visible; once the ratio has converged, the end-of-turn reconciliation changes nothing you can see.

### Reconciliation

At end of turn the provider's reported output-token count becomes the total, and the recorded history is **scaled** by the same factor rather than replaced:

```
counted 80 deltas = 80 tokens   provider says 1200 tokens   →   ×15
```

The reading, the token count and the sliding window all move together. Replacing only the total — which is what an earlier version did — left the status bar showing one rate for nineteen seconds and then jumping to another.

Corrections inside 2% adjust the total but leave history alone; rescaling by 1.01× is invisible and skipping it keeps a converged session completely inert.

### Timer Pausing

The extension automatically pauses the TPS timer when a tool call ends, regardless of tool type. This prevents tool execution time from skewing the TPS calculation. The timer resumes when the next token delta arrives.

### End-of-Stream TPS Behavior

After streaming ends, the `endTpsBehavior` option controls what TPS value is displayed:

| Behavior            | Behavior                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `average` (default) | Returns the overall average TPS (`total tokens / total elapsed seconds`). Consistent with the stats display.                                      |
| `last`              | Returns the last sliding window TPS measurement from the moment streaming stopped. Useful for seeing how fast the model was streaming at the end. |

This is also configurable via the `/tps` interactive menu.

### Color Customization

The four TPS tier colors can be customized via the `/tps` interactive menu by selecting **Colors**. Each tier opens a hex color input where you can enter a custom `#RRGGBB` value.

As you type, the input live-previews the color: once the value forms a complete valid hex string, the text is rendered in that color (and reverts if you delete characters).

Alternatively, you can set colors directly in `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "colors": {
      "slow": "#cc3333",
      "medium": "#cc8800",
      "fast": "#00cc66",
      "blazing": "#33bbdd"
    }
  }
}
```

### Display Color Customization

When using a display mode different than `tps`, the suffix parts (count, elapsed time, and TTFT) can be colorized independently via the `/tps` interactive menu by selecting **Display colors**. Each part opens a hex color input where you can enter a custom `#RRGGBB` value. By default, these parts remain uncolored (opt-in feature).

Alternatively, you can set display colors directly in `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "displayColors": {
      "count": "#00ff88",
      "elapsed": "#ffaa00",
      "ttft": "#44ddff"
    }
  }
}
```

When set, the status bar suffix renders like:

```
⚡ TPS: 25.0 tok/s (150 tok in 6.0s · TTFT: 450 ms)
```

where "150 tok" is green, "6.0s" is orange, and "450 ms" is cyan.

Display colors are independent from tier colors — they can be used together for a fully customized status bar.

### Suffix Theming

When `displayColors` is not set (or a part is empty), the suffix renders with the terminal's default foreground color. Set `suffixTheme` to `"dim"` or `"muted"` to style uncolored parts with the active theme instead:

```json
{
  "tokenSpeed": {
    "suffixTheme": "dim"
  }
}
```

Available values:

- `""` (default) — no styling (terminal default)
- `"dim"` — use the theme's dim color
- `"muted"` — use the theme's muted color

With `suffixTheme` set and no `displayColors`, the entire suffix follows the chosen theme color. With both `suffixTheme` and `displayColors` set, colored parts use the specified hex colors while uncolored parts use the chosen theme color.

Suffix theming is independent from display colors and tier colors — they can be used together for a fully customized status bar.

### Threshold Customization

The four TPS tier thresholds can be customized via the `/tps` interactive menu by selecting **Thresholds**. Each tier opens a numeric input where you can enter a non-negative integer value. Thresholds must be in strict ascending order (`slow < medium < fast < blazing`); invalid values are rejected with a warning.

Alternatively, you can set thresholds directly in `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "thresholds": {
      "slow": 0,
      "medium": 20,
      "fast": 40,
      "blazing": 60
    }
  }
}
```

### Status Update Interval

By default, the status bar updates on every token delta. If you're experiencing visual flickering, you can configure the update interval in milliseconds via the `/tps` interactive menu (`0`, `50`, `100`, `200`, `500`).

You can also set a custom value in `~/.pi/agent/settings.json`:

```json
{
  "tokenSpeed": {
    "updateInterval": 80
  }
}
```

The TPS calculation continues normally regardless of the update interval — only the status bar rendering is throttled.

### Duration Formatting

When `formatDuration` is enabled, elapsed time in the stats display is formatted into the largest sensible units:

| Elapsed | Without `formatDuration` | With `formatDuration` |
| ------- | ------------------------ | --------------------- |
| 45.67s  | `45.7s`                  | `45.7s`               |
| 92.34s  | `92.3s`                  | `1m 32.3s`            |
| 7325s   | `7325.0s`                | `2h 2m`               |
| 3d 7h   | `286940.0s`              | `3d 7h`               |
| 0s      | `0.0s`                   | `0.0s`                |

**Formatting rules**:

- `< 1min` → seconds with 0.1s precision (`0.0s`, `0.5s`, `45.7s`)
- `1min – 1h` → minutes (int) + seconds at 0.1s (`1m 0.0s`, `1m 32.3s`)
- `1h – 1d` → hours (int) + minutes (int) (`1h 0m`, `2h 5m`)
- `≥ 1d` → days (int) + hours (int) (`1d 0h`, `3d 7h`)
- All components down to the smallest unit are shown (trailing zeroes allowed)
- Sub-second values show as-is with 0.1s precision (`0.0s`, `0.5s`)

## Display Modes

| Mode    | Description                                                                 |
| ------- | --------------------------------------------------------------------------- |
| `tps`   | `⚡ TPS: 25.0 tok/s` — TPS with color-coded speed tier                      |
| `ttft`  | `⚡ TPS: 25.0 tok/s (TTFT: 450 ms)` — TPS + time-to-first-token             |
| `stats` | `⚡ TPS: 25.0 tok/s (150 tok in 6.0s)` — TPS + token count and elapsed time |
| `full`  | `⚡ TPS: 25.0 tok/s (150 tok in 6.0s · TTFT: 450 ms)` — everything          |

> **Note:** Set `icon: ""` to hide the icon prefix, rendering just `TPS: 25.0 tok/s`.

### Example: Minimal status bar

With `icon: ""` and `display: "tps"`, the status bar shows:

```
TPS: 25.0 tok/s
```

### Custom icons

The `/tps` command offers `⚡`, `🔥`, `💨`, `🚀` and none. You can also set any custom icon directly in your `settings.json`:

```json
{
  "tokenSpeed": {
    "icon": "🎯"
  }
}
```

## Commands

| Command          | Description                                            |
| ---------------- | ------------------------------------------------------ |
| `/tps`           | Open the settings menu to configure available options. |
| `/tps overrides` | Manage per-provider overrides                          |

The settings menu is described in detail in [Interactive Menu](#interactive-menu). All menus share the same keys:

- `Enter`/`Space` — change the selected value (or open its submenu)
- `r` — reset the selected row to its default: a setting, a threshold/color tier, or a provider's whole override block (confirmed before applying)
- `Esc` — go back
- In `/tps overrides` only: `a` adds a provider override, `d` deletes it (after confirmation). Unset fields show `(base)`; resetting a field to `(base)` removes it from the block

## How It Works

1. **Session Start** — Renders the initial status bar entry showing the configured icon and prefix label (default: `⚡ TPS: --`)
2. **Message Start** — When a user message starts, TTFT measurement begins. When an _assistant_ message starts, the engine marks a message boundary, because providers count output tokens cumulatively per assistant message and a turn that calls a tool streams more than one.
3. **First Token & Streaming Start** — The moment the first content block starts (`text_start`, `thinking_start`, or `toolcall_start`), the TTFT is recorded and the streaming engine starts tracking
4. **Token Update** — Each text, thinking, and tool-call delta is scored in proxy units and converted to tokens by `countStrategy` (`auto` scales those units by a learned ratio; `estimate` uses them raw; `direct` counts one per delta). With `useProviderTokens` on, provider-reported counts steer the total as they arrive.
5. **Sliding Window** — TPS is the tokens in the window divided by the window itself, truncated while the stream is younger than the window. When streaming ends, behavior depends on `endTpsBehavior`:
   - `average` (default): returns the overall average TPS for consistency with stats.
   - `last`: returns the last sliding window measurement.
6. **Agent End** — The authoritative token count (when the provider reports one) becomes the total, and the recorded history is scaled by the same factor so the reading and the count move together; the ratio it implies is learned for the next turn. Streaming is stopped.

## Dependencies

| Peer dependency                   | Purpose             |
| --------------------------------- | ------------------- |
| `@earendil-works/pi-coding-agent` | Pi Coding Agent SDK |
| `@earendil-works/pi-tui`          | Pi TUI SDK          |
