import { Schibsted_Grotesk } from "next/font/google";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Footer, Layout, Navbar } from "nextra-theme-docs";

import { Logo } from "../components/logo";
import { site } from "../lib/site";

import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "nextra-theme-docs/style.css";
import "./globals.css";

const display = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700", "800"],
  variable: "--qb-font-display",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: "Quickben: typed collections for Next.js", template: "%s | Quickben" },
  description: site.description,
  applicationName: site.name,
  authors: [{ name: site.vendor.name, url: site.vendor.url }],
  openGraph: {
    type: "website",
    siteName: site.name,
    url: site.url,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Quickben" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1620" },
  ],
};

const navbar = <Navbar logo={<Logo />} logoLink="/" projectLink={site.repo} />;

const footer = (
  <Footer>
    <span>
      Quickben is open source under Apache-2.0. Built by{" "}
      <a href={site.vendor.url} className="qb-footer-link">
        {site.vendor.name}
      </a>
      .
    </span>
  </Footer>
);

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pageMap = await getPageMap();
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning className={display.variable}>
      <Head
        color={{
          hue: { light: 228, dark: 230 },
          saturation: { light: 68, dark: 100 },
          lightness: { light: 47, dark: 78 },
        }}
        backgroundColor={{ light: "#fbfcfd", dark: "#0e1620" }}
      />
      <body>
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={pageMap}
          docsRepositoryBase={site.docsRepositoryBase}
          editLink="Edit this page on GitHub"
          feedback={{ content: "Question or problem? Open an issue", labels: "docs" }}
          sidebar={{ defaultMenuCollapseLevel: 1 }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
