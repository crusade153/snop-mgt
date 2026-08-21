'use client';

// 구성비 랭킹 가로 막대.
//
// 이것만 canvas 가 아니라 HTML/CSS 다. 축 라벨이 한글 고유명사(「(주)이마트 여주저온센터(매스)」)라
// canvas 로 그리면 길이를 몰라 잘리거나 겹치는데, HTML 이면 브라우저가 알아서 줄인다.
// 값도 막대마다 직접 붙는다 — 팔레트 대비가 3:1 미만인 색을 쓰므로 라벨 노출이 의무다.

import { formatEok } from '@/lib/sales-report/board';

export interface RankBarItem {
  key: string;
  label: string;
  /** 부제(코드·건수 등). 없으면 표시하지 않는다 */
  sub?: string;
  value: number;
  share: number;
}

interface Props {
  items: RankBarItem[];
  /** 막대 색 — 한 계열이므로 단색이다. 계열이 하나면 범례를 두지 않는다(제목이 이름을 말한다). */
  color?: string;
  emptyText?: string;
}

export default function SalesRankBars({ items, color = '#2a78d6', emptyText = '해당 기간에 자료가 없습니다.' }: Props) {
  if (items.length === 0) {
    return <div className="py-10 text-center text-sm text-neutral-400">{emptyText}</div>;
  }

  // 막대 길이는 **최대값 기준**이다. 합계 기준으로 하면 1위가 30%일 때 모든 막대가 짧아 비교가 안 된다.
  // 차감후 매출액은 반품이 크면 음수가 될 수 있으므로 길이 계산에는 절대값을 쓰고 부호는 색으로 알린다.
  const peak = Math.max(...items.map((i) => Math.abs(i.value)), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const negative = item.value < 0;
        const width = Math.max((Math.abs(item.value) / peak) * 100, 1.5);

        return (
          <li key={item.key} className="group">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-xs font-medium text-neutral-700 truncate" title={item.label}>
                {item.label}
                {item.sub && <span className="ml-1.5 text-[10px] text-neutral-400">{item.sub}</span>}
              </span>
              <span className="text-xs tabular-nums whitespace-nowrap">
                <span className={`font-bold ${negative ? 'text-[#C62828]' : 'text-neutral-900'}`}>
                  {formatEok(item.value)}
                </span>
                <span className="ml-1.5 text-neutral-400">{item.share.toFixed(1)}%</span>
              </span>
            </div>
            <div className="h-2 w-full rounded-sm bg-neutral-100 overflow-hidden">
              <div
                className="h-full rounded-sm transition-[width] duration-300"
                style={{ width: `${width}%`, background: negative ? '#e34948' : color }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
