# pi-token-speed

A [Pi Coding Agent](https://pi.dev/) extension that displays real-time **tokens-per-second (TPS)** performance metrics in the status bar while the AI is streaming responses.

## Features

- **Real-time TPS tracking** — measures token throughput as the assistant generates text and thinking content
- **Time-to-first-token (TTFT)** — measures latency from user message to the first token being generated
- **Configurable sliding window** — adjust the window size to suit your server speed (default: 1s)
- **Color-coded speed indicators** — visual feedback based on performance thresholds
- **Configurable update interval** — throttle status bar updates to reduce visual flickering
- **Provider-reported counting** — opt in to using provider-reported counts (e.g. Anthropic, OpenAI) instead of the extension's own counter
- **Per-provider overrides** — different thresholds, display mode, etc. per provider (e.g. `anthropic` vs `openai`)
- **TPS sparkline** — a short block graph (`▁▂▅█`) of recent token speed, with configurable length, bar width, coloring and scale
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
    "countStrategy": "direct",
    "endTpsBehavior": "average",
    "icon": "⚡",
    "prefix": "TPS",
    "slidingWindow": 1000,
    "updateInterval": 0,
    "formatDuration": false,
    "suffixTheme": "",
    "sparklineBars": 20,
    "sparklineBarMs": 500,
    "sparklineColorMode": "tier",
    "sparklineScale": "relative",
    "sparklineGap": "low"
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
    "countStrategy": "direct",
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
- **Engine-side** keys (`slidingWindow`, `useProviderTokens`, `countStrategy`, `endTpsBehavior`, `sparklineBars`, `sparklineBarMs`) apply at the next stream start, so the current measurement is never skewed mid-stream.

You can also manage overrides interactively with `/tps overrides` (see [Commands](#commands)).

### Configuration Validation

Invalid configuration values are automatically corrected to their defaults. A warning notification is displayed in the Pi status bar at session start listing any corrections made. The `slidingWindow` value is also clamped between `100ms` and `30000ms` (30s).

### Configuration Options

| Option               | Type                                        | Default     | Description                                                                                       |
| -------------------- | ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `thresholds.slow`    | number                                      | `0`         | Minimum TPS threshold ("slow")                                                                    |
| `thresholds.medium`  | number                                      | `15`        | TPS above this is "medium"                                                                        |
| `thresholds.fast`    | number                                      | `30`        | TPS above this is "fast"                                                                          |
| `thresholds.blazing` | number                                      | `45`        | TPS above this is "blazing"                                                                       |
| `colors.slow`        | string                                      | `"#ff4444"` | Color for slow tier                                                                               |
| `colors.medium`      | string                                      | `"#ffaa00"` | Color for medium tier                                                                             |
| `colors.fast`        | string                                      | `"#00ff88"` | Color for fast tier                                                                               |
| `colors.blazing`     | string                                      | `"#44ddff"` | Color for blazing tier                                                                            |
| `slidingWindow`      | number                                      | `1000`      | Sliding window duration in ms                                                                     |
| `display`            | `tps`, `ttft`, `stats`, `sparkline`, `full` | `tps`       | Display mode (see [Display Modes](#display-modes))                                                |
| `useProviderTokens`  | boolean                                     | `false`     | Opt-in: use provider-reported count instead of the extension one                                  |
| `countStrategy`      | `estimate`, `direct`                        | `direct`    | Token counting strategy used by the extension's own counter                                       |
| `endTpsBehavior`     | `average`, `last`                           | `average`   | What to show after streaming ends                                                                 |
| `icon`               | string                                      | `"⚡"`      | Icon shown before the prefix label in the status bar                                              |
| `prefix`             | string                                      | `"TPS"`     | Prefix label shown before the measurement                                                         |
| `updateInterval`     | number                                      | `0`         | Status bar update interval in ms (0 = every delta)                                                |
| `formatDuration`     | boolean                                     | `false`     | Show elapsed time in human-readable units (see [Duration Formatting](#duration-formatting))       |
| `suffixTheme`        | `""`, `"dim"`, `"muted"`                    | `""`        | Style for uncolored suffix parts (empty, dim, or muted)                                           |
| `sparklineBars`      | number (3–60)                               | `20`        | Number of bars in the sparkline (see [Sparkline History](#sparkline-history))                     |
| `sparklineBarMs`     | number (50–10000)                           | `500`       | Time each bar covers and averages over, in ms                                                     |
| `sparklineColorMode` | `tier`, `head`, `mono`                      | `tier`      | How sparkline bars are colored                                                                    |
| `sparklineScale`     | `relative`, `absolute`                      | `relative`  | Bars scaled against the peak in view, or against `thresholds.blazing`                             |
| `sparklineGap`       | `low`, `blank`                              | `low`       | How bars with no tokens (stalls) are drawn                                                        |
| `displayColors`      | object                                      | `{}`        | Hex colors for the suffix parts (see [Display Color Customization](#display-color-customization)) |
| `providerOverrides`  | object                                      | `{}`        | Per-provider config overrides (see [Provider Overrides](#provider-overrides))                     |

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
- **Sparkline** — length, bar width, coloring, scale and gap style for the history graph (see [Sparkline History](#sparkline-history))

Per-provider overrides are managed separately via `/tps overrides` (see [Provider Overrides](#provider-overrides)).

### Sliding Window

The sliding window determines how many recent tokens are used to calculate TPS. A larger window produces smoother readings at the cost of responsiveness; a smaller window reacts faster but can be noisier. To avoid burst spikes, the time span used in the calculation is clamped to a minimum threshold of 100ms.

#### Burst & Stall Handling

When a provider buffers output and flushes it all at once, all tokens arrive with the same timestamp. In this case, the TPS calculation extends the time span backward to include the gap since the last token, giving a more representative reading:

```
20 tokens → 5s stall → 500 tokens flushed
```

Without this handling, TPS would show `5000 tok/s` (500 tokens / 100ms clamp). With it, the reading reflects the actual throughput including the stall period (~100 tok/s).

A legitimate burst spread over time (different timestamps) is not affected — the span uses the actual time between the first and last token in the window.

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

By default, this extension uses its own token counter — the same engine behind `countStrategy`. As an alternative, you can opt in to using the provider's own reported counts instead:

| Value             | Behavior                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `false` (default) | Use this extension's own counter (controlled by `countStrategy`)                            |
| `true`            | Use the provider's reported counts instead; fall back to `countStrategy` when not available |

The extension's own counter is the default and always available. Enable `useProviderTokens: true` when your provider reports accurate token counts and you'd prefer to use them instead.

### Count Strategy

When `useProviderTokens` is `false` (default) or when the provider doesn't report counts, the `countStrategy` determines how the extension's own counter works:

| Strategy           | Behavior                            |
| ------------------ | ----------------------------------- |
| `direct` (default) | Counts each delta as 1 token        |
| `estimate`         | Approximates tokens from delta text |

The `direct` strategy is fast and preserves the original behavior — it counts each streaming delta as 1 token, including toolcall deltas. Use `estimate` when your server streams in small chunks — it approximates the real token count from the delta text, giving a more meaningful TPS reading.

> **Note:** All assistant tool-call deltas are counted — the model generates every tool's arguments during decoding, so they all consume output tokens. Tool execution time is excluded via the timer-pause mechanism.

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

### Sparkline History

Set `display` to `"sparkline"` to append a block graph of recent token speed after the measurement:

```
⚡ TPS: 42.1 tok/s ▁▁▁▁▁▁▁▂▃▅▇█▇▆▄▃▂▁▁▁
```

Each bar covers a **fixed slice of time** (`sparklineBarMs`, default `500` — pick `100`, `250`, `500`, `1000`, `2000` or `5000` in the menu, or any value in `settings.json`) and shows the average rate over that slice. Fixed slices are what make the graph readable: the jitter of individual deltas is averaged away inside each bar, and — unlike a rolling counter — a slot exists whether or not tokens arrived, so a provider stall shows up as a dip instead of being skipped and leaving a stale high bar on screen.

Total history on screen is `sparklineBars × sparklineBarMs` (default `20 × 500ms` = the last 10 seconds). History is kept across turns in a session, so the graph starts filling as soon as the first reply streams; it is cleared when the extension reloads. Changing the bar count or width takes effect at the next session start.

**Coloring** (`sparklineColorMode`):

- `tier` (default) — every bar takes the color of its own TPS tier, so a slowdown reads as a color change as well as a shape change (reuses `colors.*`)
- `head` — only the newest bar is tier-colored, history is dimmed; keeps the eye on the present
- `mono` — no colors; bars follow `suffixTheme` (or the terminal default)

**Scale** (`sparklineScale`):

- `relative` (default) — the fastest bar in view is drawn full height, so the shape of a single reply is easy to read at any speed
- `absolute` — `thresholds.blazing` is full height, so bar heights stay comparable between replies and providers (rates above the ceiling clamp to the tallest block)

**Gaps** (`sparklineGap`) control how a bar with no tokens is drawn: `low` (default) uses the shortest block so a stall reads as a flat line; `blank` uses a space so it reads as a break in the graph.

```json
{
  "tokenSpeed": {
    "display": "sparkline",
    "sparklineBars": 30,
    "sparklineBarMs": 250,
    "sparklineColorMode": "head",
    "sparklineScale": "absolute",
    "sparklineGap": "blank"
  }
}
```

The graph reflects the same token counts as the TPS number, so it inherits whatever `useProviderTokens` and `countStrategy` say about accuracy (see [Provider Token Counts](#provider-token-counts) and [Count Strategy](#count-strategy)).

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

| Mode        | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `tps`       | `⚡ TPS: 25.0 tok/s` — TPS with color-coded speed tier                      |
| `ttft`      | `⚡ TPS: 25.0 tok/s (TTFT: 450 ms)` — TPS + time-to-first-token             |
| `stats`     | `⚡ TPS: 25.0 tok/s (150 tok in 6.0s)` — TPS + token count and elapsed time |
| `full`      | `⚡ TPS: 25.0 tok/s (150 tok in 6.0s · TTFT: 450 ms)` — everything          |
| `sparkline` | `⚡ TPS: 25.0 tok/s ▁▂▅▆█▆▄▂` — TPS + recent speed history                  |

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
2. **Message Start** — When a user message starts, TTFT measurement begins
3. **First Token & Streaming Start** — The moment the first content block starts (`text_start`, `thinking_start`, or `toolcall_start`), the TTFT is recorded and the streaming engine starts tracking
4. **Token Update** — Each text, thinking, and tool-call delta is recorded. If `useProviderTokens` is `true` and the provider reports token counts, those are used directly; otherwise the extension's own counter (controlled by `countStrategy`) is used
5. **Sliding Window** — TPS is calculated using a configurable time window of token timestamps. If all events in the window share the same timestamp (a flush after a stall), the span extends backward to include the gap. When streaming ends, behavior depends on `endTpsBehavior`:
   - `average` (default): returns the overall average TPS for consistency with stats.
   - `last`: returns the last sliding window measurement.
6. **Sparkline Buckets** — In parallel, tokens are summed into fixed-width time buckets (`sparklineBarMs`), each divided by its own width. The `sparkline` display mode draws these buckets as block glyphs, oldest first.
7. **Agent End** — The authoritative token count (if available) is used to snap the total, ensuring the final average is exact. Streaming is stopped.

## Dependencies

| Peer dependency                   | Purpose             |
| --------------------------------- | ------------------- |
| `@earendil-works/pi-coding-agent` | Pi Coding Agent SDK |
| `@earendil-works/pi-tui`          | Pi TUI SDK          |
