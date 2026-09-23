"use client";

import dynamic from "next/dynamic";

import LayerTree from "@/components/LayerTree";
import InfoPanel from "@/components/InfoPanel";
import { LowStimProvider } from "@/lib/low-stim";

// The 3D viewer touches WebGL + the pointer; load it client-side only.
const AnatomyViewer = dynamic(() => import("@/components/AnatomyViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0d1117]">
      <div className="text-xs uppercase tracking-widest text-slate-500">
        initializing renderer…
      </div>
    </div>
  ),
});

export default function Home() {
  return (
    <LowStimProvider>
      <main className="flex h-dvh w-full">
        <LayerTree />
        <div className="relative min-w-0 flex-1">
          <AnatomyViewer />
        </div>
        <InfoPanel />
      </main>
    </LowStimProvider>
  );
}
