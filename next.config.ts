import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Vercel 무료 플랜 Image Optimization 한도(월 5,000건) 방지를 위한 필수 설정
  images: { 
    unoptimized: true 
  },
  // 필요한 경우 아래에 추가 설정을 작성합니다.
  reactStrictMode: true,
};

export default nextConfig;