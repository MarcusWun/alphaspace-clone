/**
 * FE-PY-7: NewsFeedPanel — click news item → addPanel("article", ...) called.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { addPanelMock, fetchNewsMock } = vi.hoisted(() => ({
  addPanelMock: vi.fn(),
  fetchNewsMock: vi.fn(),
}));

vi.mock("@/components/canvas/CanvasContext", () => ({
  useCanvas: () => ({
    workspaceId: "ws-test",
    addPanel: addPanelMock,
    updatePanelProps: vi.fn(),
    removePanel: vi.fn(),
  }),
}));

vi.mock("@/lib/queries/market", () => ({
  fetchCompanyNews: fetchNewsMock,
  newsKeys: {
    ticker: (symbol: string, from: string, to: string) => [
      "news",
      symbol,
      from,
      to,
    ],
  },
}));

vi.mock("@/lib/stores/tickerStore", () => ({
  useTickerStore: (selector: (s: { activeTicker: string }) => unknown) =>
    selector({ activeTicker: "NVDA" }),
}));

import { NewsFeedPanel } from "@/components/panels/NewsFeedPanel";

const MOCK_NEWS = [
  {
    id: 1,
    headline: "NVDA Q3 Earnings Beat",
    summary: "Beat by 15%",
    source: "Reuters",
    url: "https://reuters.com/nvda-earnings",
    datetime: 1729300000,
    image: "",
    category: "earnings",
    related: "NVDA",
  },
  {
    id: 2,
    headline: "AI Chips in Demand",
    summary: "Strong demand",
    source: "Bloomberg",
    url: "https://bloomberg.com/ai-chips",
    datetime: 1729200000,
    image: "",
    category: "tech",
    related: "NVDA",
  },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  addPanelMock.mockClear();
  fetchNewsMock.mockResolvedValue(MOCK_NEWS);
});

describe("NewsFeedPanel article spawn", () => {
  it("renders news items as buttons (not anchors)", async () => {
    const { findAllByRole } = render(
      <NewsFeedPanel panelId="news-1" />,
      { wrapper }
    );

    const buttons = await findAllByRole("button");
    // Should have news item buttons
    expect(buttons.length).toBeGreaterThanOrEqual(1);

    // Should NOT have any anchor elements for news items
    const links = screen.queryAllByRole("link");
    expect(links).toHaveLength(0);
  });

  it("calls addPanel with article config when a news item is clicked", async () => {
    const { findByText } = render(
      <NewsFeedPanel panelId="news-1" />,
      { wrapper }
    );

    const headline = await findByText("NVDA Q3 Earnings Beat");
    fireEvent.click(headline);

    expect(addPanelMock).toHaveBeenCalledOnce();
    expect(addPanelMock).toHaveBeenCalledWith("article", {
      url: "https://reuters.com/nvda-earnings",
      title: "NVDA Q3 Earnings Beat",
    });
  });

  it("calls addPanel with the correct url and title for the second item", async () => {
    const { findByText } = render(
      <NewsFeedPanel panelId="news-1" />,
      { wrapper }
    );

    const headline = await findByText("AI Chips in Demand");
    fireEvent.click(headline);

    expect(addPanelMock).toHaveBeenCalledWith("article", {
      url: "https://bloomberg.com/ai-chips",
      title: "AI Chips in Demand",
    });
  });

  it("does not render an ExternalLink icon on news items", async () => {
    const { container, findByText } = render(
      <NewsFeedPanel panelId="news-1" />,
      { wrapper }
    );

    await findByText("NVDA Q3 Earnings Beat");

    // ExternalLink from lucide renders an SVG; should not be in news items
    const svgIcons = container.querySelectorAll("svg");
    expect(svgIcons).toHaveLength(0);
  });
});
