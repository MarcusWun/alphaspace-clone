import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractArticle, ShortContentError } from "../../services/article/extract.js";

// Uses the global.fetch mock from setup.ts

beforeEach(() => {
  vi.clearAllMocks();
});

/** Build a minimal HTML page with enough text to pass the 200-char threshold */
function buildHtml(bodyContent: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Test Article</title></head>
<body>
<article>
  <h1>Test Headline</h1>
  ${bodyContent}
</article>
</body>
</html>`;
}

/** 300+ char paragraph */
const LONG_PARAGRAPH = `<p>${"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(6)}</p>`;

describe("extractArticle", () => {
  it("happy path: returns title, content, excerpt, length for well-formed HTML", async () => {
    const html = buildHtml(LONG_PARAGRAPH);
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    } as Response);

    const result = await extractArticle("https://example.com/article");

    expect(result.title).toBeTruthy();
    expect(typeof result.content).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("throws ShortContentError when extracted text is < 200 chars", async () => {
    const shortHtml = buildHtml("<p>Short.</p>");
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => shortHtml,
    } as Response);

    await expect(extractArticle("https://example.com/short")).rejects.toBeInstanceOf(
      ShortContentError
    );
  });

  it("strips <script> tags from sanitized output (XSS defense)", async () => {
    const html = buildHtml(
      `${LONG_PARAGRAPH}<script>alert('xss')</script><p>Safe content here.</p>`
    );
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    } as Response);

    const result = await extractArticle("https://example.com/xss");

    expect(result.content).not.toContain("<script>");
    expect(result.content).not.toContain("alert(");
  });

  it("strips inline event handlers from sanitized output", async () => {
    const html = buildHtml(
      `${LONG_PARAGRAPH}<p onclick="alert('xss')">Click me</p>`
    );
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => html,
    } as Response);

    const result = await extractArticle("https://example.com/event-handler");

    expect(result.content).not.toContain("onclick");
    expect(result.content).not.toContain("alert(");
  });

  it("throws an error (not ShortContentError) on non-ok HTTP response", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    } as Response);

    await expect(extractArticle("https://example.com/404")).rejects.toThrow("fetch_failed");
  });

  it("throws on fetch timeout (AbortSignal.timeout triggers)", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(
      new DOMException("The operation was aborted.", "AbortError")
    );

    await expect(extractArticle("https://example.com/timeout")).rejects.toThrow();
  });
});
