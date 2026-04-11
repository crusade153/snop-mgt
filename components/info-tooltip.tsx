'use client';

import { Info } from 'lucide-react';

interface Props {
  text: string;
  size?: number;
}

/**
 * 지표 설명 인포 툴팁 컴포넌트
 * 헤더 텍스트 옆 ⓘ 아이콘에 hover 시 설명 말풍선 표시
 */
export default function InfoTooltip({ text, size = 12 }: Props) {
  return (
    <span className="relative group inline-flex items-center">
      <Info
        size={size}
        className="text-neutral-400 hover:text-neutral-600 cursor-help transition-colors"
      />
      <span className="
        absolute bottom-full left-1/2 -translate-x-1/2 mb-2
        w-max max-w-[220px]
        bg-gray-800 text-white text-[11px] leading-relaxed
        px-3 py-2 rounded shadow-lg
        opacity-0 group-hover:opacity-100
        pointer-events-none
        transition-opacity duration-150
        z-50 whitespace-normal text-center
      ">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
      </span>
    </span>
  );
}
