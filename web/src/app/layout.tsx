import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const franklin = localFont({
  src: "../../public/fonts/6a0b3ae273b9c591afba279f_Franklin_Gothic_ATF_Black_Italic.woff2",
  variable: "--font-franklin",
  display: "swap",
  weight: "900",
  style: "italic",
});

const geist = localFont({
  src: [
    {
      path: "../../public/fonts/6a0d6cd3df7330778e84acee_Geist-Light.woff2",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/fonts/6a17254d942eb32e84bde0f0_Geist-Regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = localFont({
  src: "../../public/fonts/6a0b0eef462d20ff07b9cbe9_GeistMono-Regular.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "记忆罐头",
  description: "记忆罐头 — 你的 AI 对话记忆收藏。",
  openGraph: {
    title: "记忆罐头",
    description: "记忆罐头 — 你的 AI 对话记忆收藏。",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr-FR"
      className={`${franklin.variable} ${geist.variable} ${geistMono.variable} h-full antialiased dark no-scrollbar`}
    >
      <body className="min-h-full flex flex-col bg-black text-white font-sans overflow-hidden no-scrollbar">
        {children}
      </body>
    </html>
  );
}
