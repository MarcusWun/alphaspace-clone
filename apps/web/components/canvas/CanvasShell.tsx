"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GridLayout, { verticalCompactor, type Layout } from "react-grid-layout";
import { v4 as uuidv4 } from "uuid";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelWrapper } from "./PanelWrapper";
import { PANEL_REGISTRY, RENDERED_PANELS, TOOLBAR_PANELS } from "./PanelRegistry";
import { CanvasProvider } from "./CanvasContext";
import { WatchlistPanel } from "@/components/panels/WatchlistPanel";
import { ComparisonChartPanel } from "@/components/panels/ComparisonChartPanel";
import { NewsFeedPanel } from "@/components/panels/NewsFeedPanel";
import { StockChartPanel } from "@/components/panels/StockChartPanel";
import { FundamentalsPanel } from "@/components/panels/FundamentalsPanel";
import { AiAssistantPanel } from "@/components/panels/AiAssistantPanel";
import { ArticlePanel } from "@/components/panels/ArticlePanel";
import { cn } from "@/lib/utils";
import type { PanelConfig, PanelType, LayoutItem, WorkspaceLayout } from "@alpha/types";
import "react-grid-layout/css/styles.css";

interface CanvasShellProps {
  workspaceId: string;
  initialLayout: WorkspaceLayout | null;
  /** Called with the new layout after any user change (debounced externally) */
  onLayoutChange: (layout: WorkspaceLayout) => void;
  /** Workspace-level chart type; threaded down to comparison chart panels */
  chartType?: "line" | "candles";
}

const COLS = 12;
const ROW_HEIGHT = 50;
const DEBOUNCE_MS = 300;

function renderPanel(
  panel: PanelConfig,
  onRemove: (id: string) => void,
  chartType: "line" | "candles",
  workspaceId: string
) {
  const reg = PANEL_REGISTRY[panel.type];
  const title = panel.title ?? reg?.label ?? panel.type;

  return (
    <PanelWrapper key={panel.id} panelId={panel.id} title={title} onRemove={onRemove}>
      {panel.type === "watchlist" && (
        <WatchlistPanel panelId={panel.id} tickers={(panel.tickers as string[]) ?? []} />
      )}
      {panel.type === "comparison_chart" && (
        <ComparisonChartPanel
          panelId={panel.id}
          tickers={(panel.tickers as string[]) ?? []}
          timeRange={panel.timeRange ?? "1Y"}
          chartType={chartType}
        />
      )}
      {panel.type === "news_feed" && (
        <NewsFeedPanel panelId={panel.id} />
      )}
      {panel.type === "stock_chart" && (
        <StockChartPanel
          panelId={panel.id}
          symbol={panel.activeTicker as string | undefined}
          chartType={chartType}
        />
      )}
      {panel.type === "fundamentals" && (
        <FundamentalsPanel
          panelId={panel.id}
          symbol={panel.activeTicker as string | undefined}
        />
      )}
      {panel.type === "ai_assistant" && (
        <AiAssistantPanel panelId={panel.id} workspaceId={workspaceId} />
      )}
      {panel.type === "article" && (
        <ArticlePanel
          panelId={panel.id}
          url={panel.url as string ?? ""}
          title={panel.title as string | undefined}
        />
      )}
      {!RENDERED_PANELS.includes(panel.type) && (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          {title} — available in a future phase
        </div>
      )}
    </PanelWrapper>
  );
}

export function CanvasShell({
  workspaceId,
  initialLayout,
  onLayoutChange,
  chartType = "line",
}: CanvasShellProps) {
  const [panels, setPanels] = useState<PanelConfig[]>(
    initialLayout?.panels ?? []
  );
  const [grid, setGrid] = useState<LayoutItem[]>(initialLayout?.grid ?? []);
  const [containerWidth, setContainerWidth] = useState(1200);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure container width for responsive grid
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    obs.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => obs.disconnect();
  }, []);

  const emitChange = useCallback(
    (nextPanels: PanelConfig[], nextGrid: LayoutItem[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onLayoutChange({ panels: nextPanels, grid: nextGrid });
      }, DEBOUNCE_MS);
    },
    [onLayoutChange]
  );

  const handleGridChange = useCallback(
    (newLayout: Layout) => {
      const nextGrid: LayoutItem[] = newLayout.map((item) => ({
        i: item.i,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
      }));
      setGrid(nextGrid);
      emitChange(panels, nextGrid);
    },
    [panels, emitChange]
  );

  const addPanel = useCallback(
    (type: PanelType, propsOverride?: Record<string, unknown>) => {
      const reg = PANEL_REGISTRY[type];
      const id = uuidv4();
      const newPanel: PanelConfig = {
        id,
        type,
        ...reg.defaultProps,
        ...(propsOverride ?? {}),
      };

      // Find a free y position (below existing items)
      const maxY = grid.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);
      const newGridItem: LayoutItem = {
        i: id,
        x: 0,
        y: maxY,
        w: reg.defaultW,
        h: reg.defaultH,
        minW: reg.minW,
        minH: reg.minH,
      };

      const nextPanels = [...panels, newPanel];
      const nextGrid = [...grid, newGridItem];
      setPanels(nextPanels);
      setGrid(nextGrid);
      emitChange(nextPanels, nextGrid);

      if (type === "article") {
        requestAnimationFrame(() => {
          const el = containerRef.current?.querySelector<HTMLElement>(`[data-panel-id="${id}"]`);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    },
    [panels, grid, emitChange]
  );

  const removePanel = useCallback(
    (id: string) => {
      const nextPanels = panels.filter((p) => p.id !== id);
      const nextGrid = grid.filter((g) => g.i !== id);
      setPanels(nextPanels);
      setGrid(nextGrid);
      emitChange(nextPanels, nextGrid);
    },
    [panels, grid, emitChange]
  );

  const updatePanelProps = useCallback(
    (panelId: string, props: Record<string, unknown>) => {
      const nextPanels = panels.map((p) =>
        p.id === panelId ? { ...p, ...props } : p
      );
      setPanels(nextPanels);
      emitChange(nextPanels, grid);
    },
    [panels, grid, emitChange]
  );

  // Sync workspaceId changes (workspace switcher)
  useEffect(() => {
    setPanels(initialLayout?.panels ?? []);
    setGrid(initialLayout?.grid ?? []);
    // Cancel any pending debounced save from previous workspace
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [workspaceId, initialLayout]);

  // Convert LayoutItem[] → Layout for react-grid-layout
  const rglLayout: Layout = grid.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    resizeHandles: ["se", "s", "e"] as const,
  }));

  return (
    <CanvasProvider value={{ workspaceId, addPanel, updatePanelProps, removePanel }}>
    <div className="flex flex-col h-full">
      {/* Toolbar — article is spawned-only, excluded from TOOLBAR_PANELS */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20 shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide mr-2">
          Add panel
        </span>
        {TOOLBAR_PANELS.map((type) => (
          <Button
            key={type}
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => addPanel(type)}
          >
            <Plus className="h-3 w-3 mr-1" />
            {PANEL_REGISTRY[type].label}
          </Button>
        ))}
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {panels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <p className="text-sm">No panels yet. Add one above.</p>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={rglLayout}
            width={containerWidth}
            onLayoutChange={handleGridChange}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: [8, 8] as [number, number], containerPadding: [8, 8] as [number, number] }}
            dragConfig={{ handle: ".panel-drag-handle" }}
            resizeConfig={{ enabled: true, handles: ["se", "s", "e"] as const }}
            compactor={verticalCompactor}
          >
            {panels.map((panel) => (
              <div
                key={panel.id}
                className={cn("overflow-hidden")}
                data-testid={`panel-${panel.type}-${panel.id}`}
                data-panel-id={panel.id}
              >
                {renderPanel(panel, removePanel, chartType, workspaceId)}
              </div>
            ))}
          </GridLayout>
        )}
      </div>
    </div>
    </CanvasProvider>
  );
}
