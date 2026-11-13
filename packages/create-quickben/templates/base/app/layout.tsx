import "./globals.css";

import type { ReactNode } from "react";

export const metadata = {
  title: "{{name}}",
  description: "A Next.js app built with Quickben.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
