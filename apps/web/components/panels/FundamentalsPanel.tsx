"use client";

import { useTickerStore } from "@/lib/stores/tickerStore";
import { FundamentalsMetrics } from "./FundamentalsMetrics";
import { FundamentalsEarnings } from "./FundamentalsEarnings";
import { FundamentalsFinancials } from "./FundamentalsFinancials";
import { FundamentalsFilings } from "./FundamentalsFilings";
import { FundamentalsRecommendations } from "./FundamentalsRecommendations";

interface FundamentalsPanelProps {
  panelId: string;
  symbol?: string;
}

const DEFAULT_SYMBOL = "NVDA";

const SECTIONS = [
  { id: "metrics", label: "Valuation & Metrics", Component: FundamentalsMetrics },
  { id: "earnings", label: "Earnings", Component: FundamentalsEarnings },
  { id: "financials", label: "Financials", Component: FundamentalsFinancials },
  { id: "filings", label: "SEC Filings", Component: FundamentalsFilings },
  { id: "recommendations", label: "Analyst Recommendations", Component: FundamentalsRecommendations },
] as const;

export function FundamentalsPanel({ panelId, symbol: symbolProp }: FundamentalsPanelProps) {
  const activeTicker = useTickerStore((s) => s.activeTicker);
  const effectiveSymbol = symbolProp ?? activeTicker ?? DEFAULT_SYMBOL;

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto" data-panel-id={panelId}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {effectiveSymbol}
      </div>
      {SECTIONS.map(({ id, label, Component }) => (
        <section key={id} className="space-y-1.5" data-testid={`fundamentals-section-${id}`}>
          <h3 className="text-xs font-semibold text-foreground/80">{label}</h3>
          <Component symbol={effectiveSymbol} />
        </section>
      ))}
    </div>
  );
}
