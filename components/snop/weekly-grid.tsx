'use client';

import { useSnopStore } from '@/store/snop-store';
import { AlertTriangle, CheckCircle, AlertOctagon } from 'lucide-react';

export default function WeeklyGrid() {
  const { items, updateCell } = useSnopStore();

  if (items.length === 0) return null;

  return (
    <div className="overflow-x-auto border border-neutral-200 rounded-xl shadow-sm bg-white">
      {/* min-w-full로 설정하여 데이터가 적을 땐 꽉 차고, 많으면 스크롤 */}
      <table className="min-w-full text-xs md:text-sm border-collapse table-fixed">
        <colgroup>
          {/* 구분 컬럼: 80px 고정 (공간 절약) */}
          <col className="w-[80px] bg-neutral-50" />
          {/* 데이터 컬럼: 나머지 균등 분할 */}
          {items.map((_, i) => <col key={i} className="min-w-[70px]" />)}
        </colgroup>
        <thead>
          <tr className="bg-neutral-100 text-neutral-700 border-b border-neutral-200">
            <th className="p-2 text-center font-bold border-r border-neutral-200 sticky left-0 bg-neutral-100 z-10">구분</th>
            {items.map(item => (
              <th key={item.period} className="p-2 text-center font-bold border-r border-neutral-200 last:border-r-0">
                {item.period}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 기초 재고 */}
          <tr className="border-b border-neutral-100">
            <td className="p-2 text-center font-bold text-neutral-600 border-r border-neutral-200 sticky left-0 bg-neutral-50">기초</td>
            {items.map((item, i) => (
              <td key={i} className="p-2 text-right text-neutral-500 border-r border-neutral-100 bg-neutral-50/30">
                {item.boh.toLocaleString()}
              </td>
            ))}
          </tr>

          {/* 판매 계획 */}
          <tr className="border-b border-neutral-100">
            <td className="p-2 text-center font-bold text-blue-600 border-r border-neutral-200 sticky left-0 bg-neutral-50">📉판매</td>
            {items.map((item, i) => (
              <td key={i} className="p-0 border-r border-neutral-100 hover:bg-blue-50">
                <input 
                  type="number" 
                  value={item.demand}
                  onChange={(e) => updateCell(i, 'demand', Number(e.target.value))}
                  className="w-full h-full text-right p-2 bg-transparent outline-none font-bold text-blue-700 focus:bg-blue-100 transition-colors"
                />
              </td>
            ))}
          </tr>

          {/* 생산 계획 */}
          <tr className="border-b border-neutral-100">
            <td className="p-2 text-center font-bold text-green-700 border-r border-neutral-200 sticky left-0 bg-neutral-50">🏭생산</td>
            {items.map((item, i) => (
              <td key={i} className="p-0 border-r border-neutral-100 hover:bg-green-50">
                <input 
                  type="number" 
                  value={item.supply}
                  onChange={(e) => updateCell(i, 'supply', Number(e.target.value))}
                  className="w-full h-full text-right p-2 bg-transparent outline-none font-bold text-green-700 focus:bg-green-100 transition-colors"
                />
              </td>
            ))}
          </tr>

          {/* 기말 재고 */}
          <tr className="border-b border-neutral-200 bg-neutral-50 font-bold">
            <td className="p-2 text-center text-neutral-800 border-r border-neutral-200 sticky left-0 bg-neutral-100">📦기말</td>
            {items.map((item, i) => {
              const isShortage = item.status === 'SHORTAGE';
              return (
                <td key={i} className={`p-2 text-right border-r border-neutral-200 ${isShortage ? 'text-red-600 bg-red-50' : 'text-neutral-800'}`}>
                  {item.eoh.toLocaleString()}
                </td>
              );
            })}
          </tr>

          {/* 상태 아이콘 */}
          <tr>
            <td className="p-2 text-center text-xs text-neutral-400 border-r border-neutral-200 sticky left-0 bg-white">상태</td>
            {items.map((item, i) => (
              <td key={i} className="p-2 text-center border-r border-neutral-100">
                {item.status === 'SHORTAGE' && <div className="flex justify-center text-red-500"><AlertOctagon size={16}/></div>}
                {item.status === 'EXCESS' && <div className="flex justify-center text-orange-400"><AlertTriangle size={16}/></div>}
                {item.status === 'OK' && <div className="flex justify-center text-green-400"><CheckCircle size={16}/></div>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}