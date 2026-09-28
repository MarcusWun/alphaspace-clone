/**
 * Finnhub WebSocket stream (Phase 1 scaffold)
 *
 * Maintains ONE upstream WebSocket connection to Finnhub.
 * Ticker subscriptions/unsubscriptions are managed here.
 * Trade updates are published to Redis pub/sub channels.
 *
 * Phase 1: plumbing only — multi-client fan-out (F13) ships in Phase 2.
 * See CONTRACTS.md for channel naming conventions.
 */

import WebSocket from "ws";
import { getRedis } from "./redis.js";
import type { FinnhubWsMessage } from "@alpha/types";

const WS_URL = "wss://ws.finnhub.io";
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

interface StreamState {
  ws: WebSocket | null;
  subscribedTickers: Set<string>;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  backoffMs: number;
  stopped: boolean;
}

const state: StreamState = {
  ws: null,
  subscribedTickers: new Set(),
  reconnectTimeout: null,
  backoffMs: INITIAL_BACKOFF_MS,
  stopped: false,
};

function getFinnhubKey(): string {
  const key = process.env["FINNHUB_API_KEY"];
  if (!key) throw new Error("FINNHUB_API_KEY is not set");
  return key;
}

export function startFinnhubStream(): void {
  state.stopped = false;
  connect();
}

export function stopFinnhubStream(): void {
  state.stopped = true;
  if (state.reconnectTimeout) {
    clearTimeout(state.reconnectTimeout);
    state.reconnectTimeout = null;
  }
  state.ws?.close();
  state.ws = null;
}

export function subscribe(ticker: string): void {
  state.subscribedTickers.add(ticker.toUpperCase());
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "subscribe", symbol: ticker.toUpperCase() }));
  }
}

export function unsubscribe(ticker: string): void {
  state.subscribedTickers.delete(ticker.toUpperCase());
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(
      JSON.stringify({ type: "unsubscribe", symbol: ticker.toUpperCase() })
    );
  }
}

export function getSubscribedTickers(): ReadonlySet<string> {
  return state.subscribedTickers;
}

function connect(): void {
  if (state.stopped) return;

  const key = getFinnhubKey();
  const url = `${WS_URL}?token=${key}`;
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.on("open", () => {
    state.backoffMs = INITIAL_BACKOFF_MS;
    // Re-subscribe all known tickers after reconnect
    for (const ticker of state.subscribedTickers) {
      ws.send(JSON.stringify({ type: "subscribe", symbol: ticker }));
    }
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    let msg: FinnhubWsMessage;
    try {
      msg = JSON.parse(raw.toString()) as FinnhubWsMessage;
    } catch {
      return;
    }

    if (msg.type === "trade" && msg.data) {
      publishTrades(msg.data);
    }
  });

  ws.on("close", () => {
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error("[finnhubStream] WebSocket error", err.message);
    ws.terminate();
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (state.stopped) return;
  if (state.reconnectTimeout) return;

  state.reconnectTimeout = setTimeout(() => {
    state.reconnectTimeout = null;
    state.backoffMs = Math.min(state.backoffMs * 2, MAX_BACKOFF_MS);
    connect();
  }, state.backoffMs);
}

async function publishTrades(
  trades: NonNullable<FinnhubWsMessage["data"]>
): Promise<void> {
  const redis = getRedis();
  const grouped = new Map<string, typeof trades>();

  for (const trade of trades) {
    const list = grouped.get(trade.s) ?? [];
    list.push(trade);
    grouped.set(trade.s, list);
  }

  for (const [symbol, symbolTrades] of grouped) {
    const channel = `ticker:${symbol}:update`;
    await redis.publish(channel, JSON.stringify(symbolTrades));
  }
}
