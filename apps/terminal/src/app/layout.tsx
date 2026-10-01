import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { Providers } from "../platform/providers";
import { TerminalShell } from "../shell/terminal-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solana Corporate Terminal",
  description: "Corporate operations terminal for Solana (Devnet).",
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

export default async function RootLayout(props: { children: ReactNode }) {
  // Reading request headers opts into dynamic rendering, required for per-request CSP nonces.
  await headers();
  return (
    <html lang="en-US" className="dark">
      <body>
        <Providers>
          <TerminalShell>{props.children}</TerminalShell>
        </Providers>
      </body>
    </html>
  );
}
