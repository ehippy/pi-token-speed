import { describe, expect, it } from "vitest";

import { SettingsValidator } from "../src/config/settings-validator";
import type { TokenSpeedConfig } from "../src/config/types";
import { SETTINGS_ITEMS } from "../src/settings/defaults";
import { SettingsRegistry } from "../src/settings/items/scalar";
import {
  SPARKLINE_BAR_MS_DEFAULT,
  SPARKLINE_BARS_DEFAULT,
  SPARKLINE_COLOR_MODE_DEFAULT,
  SPARKLINE_GAP_DEFAULT,
  SPARKLINE_SCALE_DEFAULT,
} from "../src/settings/items/sparkline";
import { makeSettingsMock } from "./mocks/settings";

/** A full config with sparkline fields optionally overridden. */
const configWith = (overrides: Record<string, unknown> = {}) =>
  ({
    ...makeSettingsMock().getDefaultConfig(),
    ...overrides,
  }) as unknown as TokenSpeedConfig;

const SPARKLINE_IDS = [
  "sparklineBars",
  "sparklineBarMs",
  "sparklineColorMode",
  "sparklineScale",
  "sparklineGap",
] as const;

describe("sparkline settings", () => {
  describe("registry", () => {
    it.each([
      ["sparklineBars", SPARKLINE_BARS_DEFAULT],
      ["sparklineBarMs", SPARKLINE_BAR_MS_DEFAULT],
      ["sparklineColorMode", SPARKLINE_COLOR_MODE_DEFAULT],
      ["sparklineScale", SPARKLINE_SCALE_DEFAULT],
      ["sparklineGap", SPARKLINE_GAP_DEFAULT],
    ])("registers %s with its default", (id, value) => {
      expect(SettingsRegistry.ITEMS[id]).toBeDefined();
      expect(SettingsRegistry.ITEMS[id].getDefault()).toBe(value);
      expect(SETTINGS_ITEMS[id]).toBeDefined();
    });
  });

  describe("derived config defaults", () => {
    // Mirrors how `Settings.getDefaultConfig()` builds its scalar section.
    const derived = () =>
      Object.fromEntries(
        Object.values(SettingsRegistry.ITEMS).map((item) => [
          item.id,
          item.getDefault(),
        ]),
      );

    it("are picked up from the scalar registry", () => {
      const scalars = derived();
      expect(scalars.sparklineBars).toBe(SPARKLINE_BARS_DEFAULT);
      expect(scalars.sparklineBarMs).toBe(SPARKLINE_BAR_MS_DEFAULT);
      expect(scalars.sparklineColorMode).toBe(SPARKLINE_COLOR_MODE_DEFAULT);
      expect(scalars.sparklineScale).toBe(SPARKLINE_SCALE_DEFAULT);
      expect(scalars.sparklineGap).toBe(SPARKLINE_GAP_DEFAULT);
    });
  });

  describe("format", () => {
    it("shows the bar count as a plain number", () => {
      expect(SETTINGS_ITEMS.sparklineBars.format(configWith())).toBe("20");
    });

    it("labels known bar widths and falls back to the raw number", () => {
      expect(SETTINGS_ITEMS.sparklineBarMs.format(configWith())).toBe("500 ms");
      expect(
        SETTINGS_ITEMS.sparklineBarMs.format(
          configWith({ sparklineBarMs: 300 }),
        ),
      ).toBe("300");
    });

    it("labels the coloring, scale and gap choices", () => {
      expect(
        SETTINGS_ITEMS.sparklineColorMode.format(
          configWith({ sparklineColorMode: "head" }),
        ),
      ).toBe("Highlight newest");
      expect(
        SETTINGS_ITEMS.sparklineScale.format(
          configWith({ sparklineScale: "absolute" }),
        ),
      ).toBe("Absolute (blazing = full)");
      expect(
        SETTINGS_ITEMS.sparklineScale.format(
          configWith({ sparklineScale: "peak" }),
        ),
      ).toBe("Peak hold (relaxes)");
      expect(
        SETTINGS_ITEMS.sparklineGap.format(
          configWith({ sparklineGap: "blank" }),
        ),
      ).toBe("Blank");
    });

    it("defaults to the held peak so heights stay put", () => {
      expect(SPARKLINE_SCALE_DEFAULT).toBe("peak");
      expect(SETTINGS_ITEMS.sparklineScale.getDefault()).toBe("peak");
    });

    it("offers the menu a list of labels for enum choices", () => {
      expect(SETTINGS_ITEMS.sparklineScale.values).toEqual([
        "Peak in view",
        "Peak hold (relaxes)",
        "Absolute (blazing = full)",
      ]);
      expect(SETTINGS_ITEMS.sparklineGap.values).toEqual([
        "Low block",
        "Blank",
      ]);
      expect(SETTINGS_ITEMS.sparklineBars.values).toBeUndefined();
    });
  });

  describe("validate", () => {
    it("accepts the defaults", () => {
      for (const id of SPARKLINE_IDS) {
        const item = SETTINGS_ITEMS[id];
        expect(item.validate(item.getDefault()).valid).toBe(true);
      }
    });

    it("corrects a bar count outside the range", () => {
      const result = SETTINGS_ITEMS.sparklineBars.validate(0);
      expect(result.valid).toBe(false);
      expect(result.corrected).toBe(SPARKLINE_BARS_DEFAULT);
      expect(result.errors).toHaveLength(1);
    });

    it("accepts a non-listed but in-range bar width", () => {
      // Labels only populate the menu; any in-range width is valid config
      expect(SETTINGS_ITEMS.sparklineBarMs.validate(300)).toEqual({
        valid: true,
        corrected: 300,
      });
    });

    it("corrects an unknown color mode", () => {
      const result = SETTINGS_ITEMS.sparklineColorMode.validate("rainbow");
      expect(result.valid).toBe(false);
      expect(result.corrected).toBe(SPARKLINE_COLOR_MODE_DEFAULT);
    });
  });

  describe("setConfig (menu input)", () => {
    it("parses a numeric bar count", () => {
      expect(
        SETTINGS_ITEMS.sparklineBars.setConfig(configWith(), "32"),
      ).toEqual({ valid: true, config: { sparklineBars: 32 } });
    });

    it("resolves a labeled bar width to milliseconds", () => {
      expect(
        SETTINGS_ITEMS.sparklineBarMs.setConfig(configWith(), "2 s"),
      ).toEqual({ valid: true, config: { sparklineBarMs: 2000 } });
    });

    it("rejects an unknown gap style", () => {
      expect(
        SETTINGS_ITEMS.sparklineGap.setConfig(configWith(), "dotted").valid,
      ).toBe(false);
    });
  });

  describe("validateConfig", () => {
    const validator = new SettingsValidator();

    it("accepts a config carrying the sparkline defaults", () => {
      const { valid, errors } = validator.validateConfig(configWith());
      expect(valid).toBe(true);
      expect(errors).toEqual([]);
    });

    it("corrects an out-of-range bar width", () => {
      const { config, errors } = validator.validateConfig(
        configWith({ sparklineBarMs: 999_999 }),
      );
      expect(config.sparklineBarMs).toBe(SPARKLINE_BAR_MS_DEFAULT);
      expect(errors.some((e) => e.includes("sparklineBarMs"))).toBe(true);
    });

    it("corrects an unknown scale", () => {
      const { config } = validator.validateConfig(
        configWith({ sparklineScale: "log" }),
      );
      expect(config.sparklineScale).toBe(SPARKLINE_SCALE_DEFAULT);
    });
  });
});
