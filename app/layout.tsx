import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import QueryProvider from "@/components/query-provider"; // ✅ 추가됨

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "하림 그룹웨어 Dashboard",
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
        {/* ✅ QueryProvider로 감싸기 */}
        <QueryProvider>
          <Sidebar />
          <Header />
          <main 
            className="min-h-screen"
            style={{ 
              marginTop: 'var(--header-height)', 
              marginLeft: 'var(--sidebar-width)',
              padding: '24px'
            }}
          >
            <div className="max-w-[1600px] mx-auto">
              {children}
            </div>
          </main>
        </QueryProvider>
      </body>
    </html>
  );
}