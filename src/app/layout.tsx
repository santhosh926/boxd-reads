import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BoxdReads",
  description: "Find books behind your favorite Letterboxd films."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
