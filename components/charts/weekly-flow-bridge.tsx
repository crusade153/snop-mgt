'use client';

// 주간 재고 증감 브리지 — 「이번 주 재고는 왜 변했나」를 생산·출고·기타 세 막대로 나눈다.
//
// canvas 가 아니라 HTML/CSS 다. 막대가 세 개뿐이고 라벨·값을 막대마다 직접 붙여야 해서
// div 폭으로 그리는 편이 선명하고 테마·리사이즈에 따로 손댈 것이 없다(sales-rank-bars 와 같은 이유).
//
// ⚠️ **축은 0(= 전주 재고)에서 시작하는 차이 브리지다.** 전주·금주 재고(120억대)를 막대로 세우면
// 20억짜리 증감이 납작해서 안 읽히고, 그렇다고 축을 100억부터 자르면 차이가 과장된다.
// 그래서 양 끝 재고는 숫자로만 두고 막대는 증감만 그린다.
//
// ⚠️ **「기타」를 숨기지 말 것.** 메인 표 「대차 차이」(`balanceGap`)와 같은 값의 부호를 뒤집은 것이다
// (전주 + 생산 − 출고 − 기타 = 금주). 폐기·반품·재평가·적재 시점 차이가 섞여 0 이 아닌 게 정상이지만,
// 이 막대가 생산·출고만큼 커지면 적재 자체가 이상하다는 신호다.

import { formatNoteAmount, formatSignedNoteAmount } from '@/lib/weekly/board';
import InfoTooltip from '@/components/info-tooltip';

interface Props {
  previousStockValue: number;
  producedValue: number;
  shippedValue: number;
  stockValue: number;
  /** 전주 재고 + 생산 − 출고 − 금주 재고 (메인 표 「대차 차이」) */
  balanceGap: number;
  /** 전주 스냅샷이 있는지. 없으면 증감을 나눌 수 없다 */
  hasPrevious: boolean;
  /** 진행 중인 주차인지. 흐름 열이 주중 누계라 잠정치다 */
  provisional: boolean;
}

interface Step {
  key: string;
  label: string;
  hint?: string;
  start: number;
  end: number;
  color: string;
  strong?: boolean;
}

/** 증가는 파랑, 감소는 빨강 — 메인 표 「전주 比 증감액」 칸과 같은 색이라 범례가 필요 없다 */
const COLOR_UP = '#1565C0';
const COLOR_DOWN = '#C62828';
const COLOR_OTHER = '#9E9E9E';
const COLOR_NET = '#37474F';

const GAP_HINT =
  '전주 재고 + 생산 − 출고 와 금주 재고의 차이입니다(메인 표 「대차 차이」와 같은 값). ' +
  '폐기·반품·재평가·적재 시점 차이가 섞여 0 이 되지 않는 것이 정상이지만, 생산·출고만큼 커지면 적재를 확인해 보세요.';

export default function WeeklyFlowBridge({
  previousStockValue,
  producedValue,
  shippedValue,
  stockValue,
  balanceGap,
  hasPrevious,
  provisional,
}: Props) {
  if (!hasPrevious) {
    return (
      <div className="py-8 text-center text-xs text-neutral-400">
        직전 주차 적재가 없어 증감을 나눌 수 없습니다.
        <div className="mt-1 text-neutral-500">
          금주 재고 <b className="tabular-nums">{formatNoteAmount(stockValue)}</b>
        </div>
      </div>
    );
  }

  // 누적 위치. 전주 재고를 0 으로 놓고 증감만 쌓는다.
  const afterProduce = producedValue;
  const afterShip = afterProduce - shippedValue;
  // 기타 막대는 메인 표 「대차 차이」 값을 그대로 쓴다(직접 빼서 만들지 않는다). 정의상 끝점 = 금주 − 전주.
  const afterOther = afterShip - balanceGap;
  const net = stockValue - previousStockValue;

  const steps: Step[] = [
    { key: 'produce', label: '생산', start: 0, end: afterProduce, color: COLOR_UP },
    { key: 'ship', label: '출고', start: afterProduce, end: afterShip, color: COLOR_DOWN },
    { key: 'other', label: '기타', hint: GAP_HINT, start: afterShip, end: afterOther, color: COLOR_OTHER },
    { key: 'net', label: '순증감', start: 0, end: net, color: COLOR_NET, strong: true },
  ];

  const points = [0, afterProduce, afterShip, afterOther, net];
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const pct = (value: number) => ((value - lo) / span) * 100;
  const zero = pct(0);
  const netRate = previousStockValue > 0 ? net / previousStockValue : null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-neutral-500">
          전주 재고 <b className="tabular-nums text-neutral-800">{formatNoteAmount(previousStockValue)}</b>
          <span className="mx-1.5 text-neutral-300">→</span>
          금주 재고 <b className="tabular-nums text-neutral-800">{formatNoteAmount(stockValue)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          {provisional && (
            <span className="flex items-center gap-0.5 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
              잠정
              <InfoTooltip text="진행 중인 주차라 출고·생산이 주중 누계입니다. BigQuery 미러가 하루 늦게 채워지므로 주가 지난 뒤 다시 적재하면 값이 늘어납니다." />
            </span>
          )}
          <b className={`tabular-nums ${net < 0 ? 'text-[#C62828]' : 'text-[#1565C0]'}`}>
            {formatSignedNoteAmount(net)}
          </b>
          {netRate !== null && (
            <span className="tabular-nums text-neutral-400">
              ({net > 0 ? '+' : ''}
              {(netRate * 100).toFixed(1)}%)
            </span>
          )}
        </span>
      </div>

      <ul className="space-y-2" aria-label="전주 대비 재고 증감 브리지">
        {steps.map((step) => {
          const delta = step.end - step.start;
          const left = pct(Math.min(step.start, step.end));
          const width = Math.max(Math.abs(pct(step.end) - pct(step.start)), 0.6);
          return (
            <li
              key={step.key}
              className={`grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 ${
                step.strong ? 'border-t border-neutral-100 pt-2' : ''
              }`}
            >
              <span
                className={`flex items-center gap-0.5 text-xs ${
                  step.strong ? 'font-bold text-neutral-800' : 'text-neutral-600'
                }`}
              >
                {step.label}
                {step.hint && <InfoTooltip text={step.hint} />}
              </span>
              <div className="relative h-4 rounded-sm bg-neutral-50">
                {/* 0 기준선(= 전주 재고) */}
                <div
                  className="absolute inset-y-[-3px] w-px bg-neutral-300"
                  style={{ left: `${zero}%` }}
                  aria-hidden
                />
                <div
                  className="absolute inset-y-0 rounded-sm transition-[left,width] duration-300"
                  style={{ left: `${left}%`, width: `${width}%`, background: step.color }}
                  title={`${step.label} ${formatSignedNoteAmount(delta)}`}
                />
              </div>
              <span
                className={`text-right text-xs tabular-nums ${
                  step.strong ? 'font-bold text-neutral-900' : 'text-neutral-700'
                }`}
              >
                {formatSignedNoteAmount(delta)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
