"use client";

/**
 * LowStimProvider - "Low Cognitive Load" accessibility mode.
 *
 * When active it:
 *  - flags the 3D canvas to drop anti-aliasing & DPR (canvas remounts with
 *    `key={lowStim ? "low-stim" : "standard"}` in page.tsx) and disables all
 *    pulsing/post-processing-style animations (see AnatomyViewer)
 *  - switches the whole UI to a strict high-contrast dark theme via a
 *    `data-ls="on"` attribute (see globals.css)
 *  - replaces FMA terminology with common-name aliases (aliasTerm / useLowStim)
 *
 * The preference persists to localStorage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { aliasTerm } from "@/lib/aliases";

interface LowStimContextValue {
  lowStim: boolean;
  setLowStim: (on: boolean) => void;
  toggle: () => void;
  /** plain-language alias for a term under the current mode */
  t: (term: string) => string;
}

const LowStimContext = createContext<LowStimContextValue | null>(null);

const STORAGE_KEY = "anatomy-engine.low-stim";

export function LowStimProvider({ children }: { children: React.ReactNode }) {
  const [lowStim, setLowStimState] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem(STORAGE_KEY) === "1") setLowStimState(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.ls = lowStim ? "on" : "off";
  }, [lowStim]);

  const setLowStim = useCallback((on: boolean) => {
    setLowStimState(on);
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  }, []);

  const value = useMemo<LowStimContextValue>(
    () => ({
      lowStim,
      setLowStim,
      toggle: () => setLowStim(!lowStim),
      t: (term: string) => aliasTerm(term, lowStim),
    }),
    [lowStim, setLowStim],
  );

  return (
    <LowStimContext.Provider value={value}>{children}</LowStimContext.Provider>
  );
}

export function useLowStim(): LowStimContextValue {
  const ctx = useContext(LowStimContext);
  if (!ctx) throw new Error("useLowStim must be used within LowStimProvider");
  return ctx;
}
