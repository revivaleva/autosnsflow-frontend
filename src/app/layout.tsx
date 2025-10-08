import "@aws-amplify/ui-react/styles.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "T-Booster",
  description: "Threads Manage Tool",
  icons: {
    icon: '/T-Booster_icon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={inter.variable}>
        <main>{children}</main>
      </body>
    </html>
  );
}