"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PanelType } from "@alpha/types";

export interface CanvasContextValue {
  workspaceId: string;
  addPanel: (type: PanelType, propsOverride?: Record<string, unknown>) => void;
  updatePanelProps: (panelId: string, props: Record<string, unknown>) => void;
  removePanel: (id: string) => void;
}

const CanvasContext = createContext<CanvasContextValue | null>(null);

export function CanvasProvider({
  value,
  children,
}: {
  value: CanvasContextValue;
  children: ReactNode;
}) {
  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas(): CanvasContextValue {
  const v = useContext(CanvasContext);
  if (!v) throw new Error("useCanvas must be used inside <CanvasProvider>");
  return v;
}
