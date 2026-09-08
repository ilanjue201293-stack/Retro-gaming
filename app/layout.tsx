import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./hockey.css";
import "./hockey-v2.css";

export const metadata: Metadata = {
  title: "Retro Gaming",
  description: "Mini-jeux privés entre amis.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080a0f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
