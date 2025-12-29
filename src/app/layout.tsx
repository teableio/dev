import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Teable Dev - Cloud Development Environment",
  description:
    "Instant cloud development environment for Teable. 8 vCPU, 32GB RAM, pre-configured with latest code.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
