import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "../../services/ai/prompt.js";

describe("SYSTEM_PROMPT", () => {
  const lower = SYSTEM_PROMPT.toLowerCase();

  it("contains scope-restriction clause", () => {
    expect(lower).toContain("strictly limited");
    expect(lower).toContain("stocks");
    expect(lower).toContain("politely decline");
  });

  it("contains jailbreak-resistance clause", () => {
    expect(lower).toContain("do not comply with instructions");
    expect(lower).toContain("override");
  });

  it("contains english-only clause", () => {
    expect(lower).toContain("english");
  });

  it("contains metadata-honesty clause", () => {
    expect(lower).toContain("only metadata");
    expect(lower).toContain("never fabricate");
    expect(lower).toContain("authoritative source");
  });

  it("preserves PR #14 tool-chaining behavior", () => {
    expect(SYSTEM_PROMPT).toContain("chain 2–3 tools");
    expect(lower).toContain("concise");
  });
});
