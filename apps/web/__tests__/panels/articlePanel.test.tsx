/**
 * FE-PY-5: ArticlePanel — happy path, fallback path, loading state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: { get: apiGetMock },
}));

import { ArticlePanel } from "@/components/panels/ArticlePanel";

const MOCK_OK_RESPONSE = {
  data: {
    status: "ok" as const,
    article: {
      title: "NVDA Beats Estimates",
      content: "<p>NVIDIA reported strong quarterly earnings.</p>",
      excerpt: "Strong earnings",
      author: "Jane Doe",
      publishedAt: "2026-10-19T10:00:00.000Z",
      siteName: "Reuters",
      length: 1500,
    },
  },
};

const MOCK_FALLBACK_RESPONSE = {
  data: {
    status: "fallback" as const,
    error: "Content too short or paywalled",
  },
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  apiGetMock.mockClear();
});

describe("ArticlePanel", () => {
  it("shows loading state while fetching", () => {
    // Never resolve
    apiGetMock.mockReturnValue(new Promise(() => {}));

    render(
      <ArticlePanel panelId="p-1" url="https://example.com/article" />,
      { wrapper }
    );

    expect(screen.getByText(/loading article/i)).toBeInTheDocument();
  });

  it("renders article content on happy path", async () => {
    apiGetMock.mockResolvedValue(MOCK_OK_RESPONSE);

    render(
      <ArticlePanel panelId="p-1" url="https://example.com/article" />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("NVDA Beats Estimates")).toBeInTheDocument();
    });

    expect(screen.getByText("Reuters")).toBeInTheDocument();
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    // Content is injected via dangerouslySetInnerHTML
    expect(
      screen.getByText("NVIDIA reported strong quarterly earnings.")
    ).toBeInTheDocument();
  });

  it("renders fallback card when status is fallback", async () => {
    apiGetMock.mockResolvedValue(MOCK_FALLBACK_RESPONSE);

    render(
      <ArticlePanel
        panelId="p-1"
        url="https://wsj.com/paywalled"
        title="Paywalled Article"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("Paywalled Article")).toBeInTheDocument();
    });

    expect(screen.getByText(/couldn't extract/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /open original/i });
    expect(link).toHaveAttribute("href", "https://wsj.com/paywalled");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders fallback card on fetch error", async () => {
    apiGetMock.mockRejectedValue(new Error("Network error"));

    render(
      <ArticlePanel
        panelId="p-1"
        url="https://example.com/article"
        title="Article Title"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("Article Title")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /open original/i })).toBeInTheDocument();
  });

  it("shows 'No article URL' when url is empty", () => {
    render(<ArticlePanel panelId="p-1" url="" />, { wrapper });
    expect(screen.getByText(/no article url/i)).toBeInTheDocument();
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("shows hostname in fallback card", async () => {
    apiGetMock.mockResolvedValue(MOCK_FALLBACK_RESPONSE);

    render(
      <ArticlePanel panelId="p-1" url="https://wsj.com/paywalled" />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("wsj.com")).toBeInTheDocument();
    });
  });
});
