import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";

export interface ArticleResult {
  title: string;
  content: string;      // sanitized HTML
  excerpt: string;
  author?: string;
  publishedAt?: string; // ISO 8601
  siteName?: string;
  length: number;       // char count of plain text
}

export class ShortContentError extends Error {
  constructor(message = "Article content too short") {
    super(message);
    this.name = "ShortContentError";
  }
}

/** Allowed tags for sanitized article HTML */
const ALLOWED_TAGS = [
  "p", "br", "strong", "em", "b", "i", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "img", "figure", "figcaption",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "rel", "target"],
    img: ["src", "alt", "width", "height"],
  },
  allowedSchemes: ["http", "https"],
  disallowedTagsMode: "discard",
};

export async function extractArticle(url: string): Promise<ArticleResult> {
  const response = await fetch(url, {
    headers: { "User-Agent": "alpha-investment-workspace/1.0" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`fetch_failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();

  if (!article || (article.textContent?.length ?? 0) < 200) {
    throw new ShortContentError();
  }

  const cleanContent = sanitizeHtml(article.content ?? "", SANITIZE_OPTIONS);

  return {
    title: article.title ?? "",
    content: cleanContent,
    excerpt: article.excerpt ?? "",
    author: article.byline ?? undefined,
    publishedAt: undefined, // Readability does not reliably extract publication date
    siteName: article.siteName ?? undefined,
    length: article.textContent?.length ?? 0,
  };
}
