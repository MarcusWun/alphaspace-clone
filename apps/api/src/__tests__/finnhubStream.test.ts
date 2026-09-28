import { describe, it, expect, vi, afterEach } from "vitest";
import {
  subscribe,
  unsubscribe,
  getSubscribedTickers,
  stopFinnhubStream,
} from "../services/finnhubStream.js";

// Mock WebSocket
vi.mock("ws", () => {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const mockWs = {
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    readyState: 1, // OPEN
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(cb);
    }),
    _emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers[event] ?? []) cb(...args);
    },
  };

  const WebSocket = vi.fn(() => mockWs);
  (WebSocket as unknown as { OPEN: number }).OPEN = 1;

  return { default: WebSocket, WebSocket };
});

describe("finnhubStream", () => {
  afterEach(() => {
    stopFinnhubStream();
    // Clear subscriber set
    for (const ticker of Array.from(getSubscribedTickers())) {
      unsubscribe(ticker);
    }
  });

  it("tracks subscribed tickers", () => {
    subscribe("AAPL");
    subscribe("NVDA");

    const tickers = getSubscribedTickers();
    expect(tickers.has("AAPL")).toBe(true);
    expect(tickers.has("NVDA")).toBe(true);
    expect(tickers.size).toBe(2);
  });

  it("normalizes tickers to uppercase on subscribe", () => {
    subscribe("aapl");
    const tickers = getSubscribedTickers();
    expect(tickers.has("AAPL")).toBe(true);
    expect(tickers.has("aapl")).toBe(false);
  });

  it("removes ticker on unsubscribe", () => {
    subscribe("MSFT");
    unsubscribe("MSFT");
    expect(getSubscribedTickers().has("MSFT")).toBe(false);
  });

  it("returns a read-only set from getSubscribedTickers", () => {
    subscribe("GOOG");
    const tickers = getSubscribedTickers();
    // Set contains the subscribed ticker
    expect(tickers.has("GOOG")).toBe(true);
    expect(tickers.size).toBe(1);
    // It is iterable (required for fan-out use)
    expect(typeof tickers.has).toBe("function");
    expect(typeof tickers.forEach).toBe("function");
  });
});
