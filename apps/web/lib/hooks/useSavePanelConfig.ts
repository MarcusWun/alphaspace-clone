"use client";

import { useMemo, useEffect, useRef } from "react";
import { useCanvas } from "@/components/canvas/CanvasContext";

function debounce(fn: (next: Record<string, unknown>) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (next: Record<string, unknown>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(next), ms);
  };
}

export function useSavePanelConfig(panelId: string) {
  const { updatePanelProps } = useCanvas();
  // Track the latest props so unmount flush can fire synchronously
  const latestRef = useRef<Record<string, unknown> | null>(null);

  const debouncedSave = useMemo(
    () =>
      debounce((next: Record<string, unknown>) => {
        updatePanelProps(panelId, next);
      }, 500),
    [panelId, updatePanelProps]
  );

  // Flush on unmount: synchronously push the latest tracked props
  useEffect(() => {
    return () => {
      if (latestRef.current) updatePanelProps(panelId, latestRef.current);
    };
  }, [panelId, updatePanelProps]);

  return (next: Record<string, unknown>) => {
    latestRef.current = next;
    debouncedSave(next);
  };
}
