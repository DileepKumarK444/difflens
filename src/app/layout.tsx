import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { ProviderBanner } from "@/components/layout/provider-banner";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DiffLens",
  description: "Local-first AI code review",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full bg-background text-foreground">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-3 focus:py-1.5 focus:text-primary-foreground">
          Skip to content
        </a>
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <ProviderBanner />
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-6 outline-none">{children}</main>
        </div>
      </body>
    </html>
  );
}
