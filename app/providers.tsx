"use client";

/**
 * Client-side providers root. next-auth/react v4 must live behind a client
 * boundary (it uses React context, which cannot be created in a server
 * component — see layout.tsx).
 */
import { SessionProvider } from "next-auth/react";

export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
