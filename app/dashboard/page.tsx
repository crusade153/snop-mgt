// app/dashboard/page.tsx
import { getLatestOrders } from '@/actions/order-actions';
import { getInventoryStatus } from '@/actions/inventory-actions';
import { getProductionPlan } from '@/actions/production-actions';
import { aggregateData } from '@/utils/snop-aggregation';

export default async function DashboardPage() {
  // 1. 3가지 데이터를 병렬로 동시에 가져옵니다 (속도 최적화)
  const [orders, inventory, production] = await Promise.all([
    getLatestOrders(),
    getInventoryStatus(),
    getProductionPlan()
  ]);

  // 2. 가져온 데이터를 주차별, 제품별로 하나로 합칩니다.
  const snopData = aggregateData(orders, inventory, production);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-2 text-gray-800">📊 S&OP 통합 대시보드</h1>
      <p className="text-gray-500 mb-8">판매, 생산, 재고 현황을 주차별로 통합하여 보여줍니다.</p>

      {/* 요약 카드 영역 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
          <h3 className="text-blue-600 font-semibold mb-1">총 수요 (Orders)</h3>
          <p className="text-3xl font-bold text-gray-900">
            {snopData.reduce((acc, cur) => acc + cur.demand, 0).toLocaleString()}
            <span className="text-sm font-normal text-gray-500 ml-1">ea</span>
          </p>
        </div>
        <div className="bg-green-50 p-6 rounded-xl border border-green-100">
          <h3 className="text-green-600 font-semibold mb-1">총 공급 (Production)</h3>
          <p className="text-3xl font-bold text-gray-900">
            {snopData.reduce((acc, cur) => acc + cur.supply, 0).toLocaleString()}
            <span className="text-sm font-normal text-gray-500 ml-1">ea</span>
          </p>
        </div>
        <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
          <h3 className="text-purple-600 font-semibold mb-1">데이터 포인트</h3>
          <p className="text-3xl font-bold text-gray-900">
            {snopData.length}
            <span className="text-sm font-normal text-gray-500 ml-1">건</span>
          </p>
        </div>
      </div>

      {/* 통합 데이터 테이블 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-100 text-gray-700 font-semibold">
            <tr>
              <th className="px-6 py-4">주차 (Week)</th>
              <th className="px-6 py-4">자재명 (Product)</th>
              <th className="px-6 py-4 text-right bg-blue-50/50">수요 (Demand)</th>
              <th className="px-6 py-4 text-right bg-green-50/50">공급 (Supply)</th>
              <th className="px-6 py-4 text-right bg-gray-50/50">재고 변동 (Delta)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {snopData.map((row, idx) => {
              const delta = row.supply - row.demand;
              const deltaClass = delta < 0 ? 'text-red-600 font-bold' : 'text-blue-600';
              
              return (
                <tr key={`${row.week}-${row.matnr}-${idx}`} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-mono text-gray-600">{row.week}</td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{row.matnr_t || '-'}</div>
                    <div className="text-xs text-gray-400">{row.matnr}</div>
                  </td>
                  <td className="px-6 py-4 text-right bg-blue-50/30">
                    {row.demand.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right bg-green-50/30">
                    {row.supply.toLocaleString()}
                  </td>
                  <td className={`px-6 py-4 text-right bg-gray-50/30 ${deltaClass}`}>
                    {delta > 0 ? '+' : ''}{delta.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        
        {snopData.length === 0 && (
          <div className="p-12 text-center text-gray-500">
            데이터가 충분하지 않아 집계할 수 없습니다.
          </div>
        )}
      </div>
    </div>
  );
}