import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Text2Form: plain English to 3D parts",
  description: "Describe a mechanical part in plain English and download a printable STL.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
