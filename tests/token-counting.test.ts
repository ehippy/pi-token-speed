import { describe, expect, it } from "vitest";

import {
  MAX_TOKENS_PER_UNIT,
  MIN_TOKENS_PER_UNIT,
  NEUTRAL_TOKENS_PER_UNIT,
  TokenCalibration,
} from "../src/core/token-calibration";
import { TokenEstimator } from "../src/core/token-estimator";

describe("TokenEstimator", () => {
  const estimator = new TokenEstimator();
  const units = (text: string) => estimator.units(text);

  it("scores nothing for empty text", () => {
    expect(units("")).toBe(0);
  });

  it("scores one unit per word run", () => {
    expect(units("hello")).toBe(1);
    expect(units("hello world")).toBe(2);
    expect(units("  spaced   out  ")).toBe(2);
  });

  it("scores one unit per symbol", () => {
    expect(units(" hi!")).toBe(2); // word + punctuation
    expect(units("a=b")).toBe(3); // two words around one symbol
  });

  it("scores a line of code by its parts", () => {
    expect(units("const x = 1;")).toBe(5); // const, x, 1, =, ;
  });

  it("never scores a non-empty delta as zero", () => {
    // A bare space is its own token in most vocabularies; scoring it as zero
    // would undercount token-granular streams by one token per word.
    expect(units(" ")).toBe(1);
    expect(units("\n\n")).toBe(1);
  });

  it("scales with length rather than with delta boundaries", () => {
    const sentence = "The quick brown fox jumps over the lazy dog";
    expect(units(sentence)).toBe(9);
    // The same text arriving as one chunk or nine must score the same.
    expect(units(sentence.split(" ").join(""))).toBeLessThan(units(sentence));
    expect(units("The ")).toBe(1);
  });

  it("scores non-Latin text one unit per character", () => {
    // A documented bias, absorbed by calibration rather than by this class.
    expect(units("你好世界")).toBe(4);
  });
});

describe("TokenCalibration", () => {
  it("is neutral for an uncalibrated or missing key", () => {
    const calibration = new TokenCalibration();
    expect(calibration.ratioFor("litellm/qwen")).toBe(NEUTRAL_TOKENS_PER_UNIT);
    expect(calibration.ratioFor(undefined)).toBe(NEUTRAL_TOKENS_PER_UNIT);
  });

  it("takes the first measurement at face value", () => {
    const calibration = new TokenCalibration();
    expect(calibration.observe("p/m", 4, 8)).toBeCloseTo(2, 6);
    expect(calibration.ratioFor("p/m")).toBeCloseTo(2, 6);
  });

  it("weights evidence by volume, so real answers decide the ratio", () => {
    const calibration = new TokenCalibration();
    calibration.observe("p/m", 100, 200); // ratio 2, 200 tokens of evidence
    calibration.observe("p/m", 100, 300); // ratio 3, 300 tokens of evidence

    // (2·200 + 3·300) / 500
    expect(calibration.ratioFor("p/m")).toBeCloseTo(2.6, 6);
  });

  it("keeps adapting after a large measurement", () => {
    const calibration = new TokenCalibration();
    calibration.observe("p/m", 4000, 8000); // ratio 2, evidence at the cap
    calibration.observe("p/m", 100, 100); // ratio 1

    expect(calibration.ratioFor("p/m")).toBeLessThan(2);
    expect(calibration.ratioFor("p/m")).toBeGreaterThan(1.9);
  });

  it("clamps an implausible ratio", () => {
    const tooDense = new TokenCalibration();
    expect(tooDense.observe("p/m", 1, 10_000)).toBe(MAX_TOKENS_PER_UNIT);

    const tooSparse = new TokenCalibration();
    expect(tooSparse.observe("p/m", 10_000, 1)).toBe(MIN_TOKENS_PER_UNIT);
  });

  it.each([
    [0, 10],
    [10, 0],
    [-5, 10],
    [10, -1],
  ])("ignores a measurement it cannot use (%s units, %s tokens)", (u, t) => {
    const calibration = new TokenCalibration();
    expect(calibration.observe("p/m", u, t)).toBe(NEUTRAL_TOKENS_PER_UNIT);
    expect(calibration.ratioFor("p/m")).toBe(NEUTRAL_TOKENS_PER_UNIT);
  });

  it("ignores a measurement with no key", () => {
    const calibration = new TokenCalibration();
    expect(calibration.observe(undefined, 10, 20)).toBe(
      NEUTRAL_TOKENS_PER_UNIT,
    );
    expect(calibration.snapshot()).toEqual({});
  });

  it("keeps a separate ratio per target", () => {
    const calibration = new TokenCalibration();
    calibration.observe("litellm/a", 10, 30);
    calibration.observe("anthropic/b", 10, 10);

    expect(calibration.ratioFor("litellm/a")).toBeCloseTo(3, 6);
    expect(calibration.ratioFor("anthropic/b")).toBeCloseTo(1, 6);
    expect(Object.keys(calibration.snapshot())).toEqual([
      "litellm/a",
      "anthropic/b",
    ]);
  });

  it("reports the evidence behind each ratio", () => {
    const calibration = new TokenCalibration();
    calibration.observe("p/m", 10, 30);

    expect(calibration.snapshot()["p/m"]).toEqual({
      ratio: 3,
      evidence: 30,
    });
  });

  it("forgets everything on reset", () => {
    const calibration = new TokenCalibration();
    calibration.observe("p/m", 10, 30);
    calibration.reset();

    expect(calibration.ratioFor("p/m")).toBe(NEUTRAL_TOKENS_PER_UNIT);
    expect(calibration.snapshot()).toEqual({});
  });
});
