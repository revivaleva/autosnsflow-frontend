import "@aws-amplify/ui-react/styles.css";
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoSNSFlow",
  description: "自動投稿管理システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}>
        <main>{children}</main>
      </body>
    </html>
  );
}