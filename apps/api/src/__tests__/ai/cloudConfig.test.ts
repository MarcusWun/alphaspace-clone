import { describe, it, expect, vi } from "vitest";
import { isCloudConfigured } from "../../services/ai/cloudConfig.js";

describe("isCloudConfigured", () => {
  it("returns false when key is unset", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", undefined as unknown as string);
    expect(isCloudConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false when key is empty string", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(isCloudConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false for the placeholder value", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "your_anthropic_api_key_here");
    expect(isCloudConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false for any your_ prefix", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "your_abcde_very_long_key_indeed_123456");
    expect(isCloudConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns false for a 15-char key (too short)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-xx");
    expect(isCloudConfigured()).toBe(false);
    vi.unstubAllEnvs();
  });

  it("returns true for a plausibly-real 40-char key", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(isCloudConfigured()).toBe(true);
    vi.unstubAllEnvs();
  });
});
