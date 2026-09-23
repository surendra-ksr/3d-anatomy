import type { Metadata } from "next";

import Providers from "@/app/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "Interactive Anatomy Engine",
  description:
    "Web-based 3D anatomy explorer built on BodyParts3D (DBCLS) meshes mapped to the FMA ontology, delivered as Draco-compressed glTF.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-slate-950 text-slate-200 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
