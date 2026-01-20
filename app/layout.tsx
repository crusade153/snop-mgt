import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import QueryProvider from "@/components/query-provider";
import LayoutShell from "@/components/layout-shell"; // ✅ 추가됨

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "하림산업 S&OP Dashboard",
  description: "Harim Nexus S&OP System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} antialiased bg-neutral-50`}>
        <QueryProvider>
          {/* ✅ 조건부 렌더링을 위해 LayoutShell 사용 */}
          <LayoutShell>
            {children}
          </LayoutShell>
        </QueryProvider>
      </body>
    </html>
  );
}