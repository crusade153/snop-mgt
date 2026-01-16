import { getProductionPlan } from '@/actions/production-actions';

export default async function ProductionPage() {
  const plans = await getProductionPlan();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">🏭 생산 계획 및 실적 (Production)</h1>
        <span className="text-sm text-gray-500">총 {plans.length}건 오더</span>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
        <table className="w-full text-sm text-left text-gray-600">
          <thead className="bg-gray-50 text-gray-700 uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">오더 정보</th>
              <th className="px-6 py-3">제품명</th>
              <th className="px-6 py-3">계획일자</th>
              <th className="px-6 py-3 text-right">계획 수량</th>
              <th className="px-6 py-3 text-right">실적 수량</th>
              <th className="px-6 py-3 text-center">달성률</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => {
              // 달성률 계산 (계획이 0이면 0%)
              const rate = plan.PSMNG > 0 ? (plan.LMNGA / plan.PSMNG) * 100 : 0;
              // 달성률에 따른 색상 (100% 이상: 초록, 90% 미만: 빨강)
              const rateColor = rate >= 100 ? 'text-green-600' : rate < 90 ? 'text-red-500' : 'text-yellow-600';

              return (
                <tr key={plan.AUFNR} className="border-b hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <div className="font-bold text-gray-900">{plan.AUFNR}</div>
                    <div className="text-xs text-gray-400">{plan.TXT}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-gray-900">{plan.MAKTX}</div>
                    <div className="text-xs text-gray-400">{plan.MATNR}</div>
                  </td>
                  <td className="px-6 py-4 font-mono text-gray-500">
                    {plan.GSTRP}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {plan.PSMNG.toLocaleString()} {plan.MEINS}
                  </td>
                  <td className="px-6 py-4 text-right font-bold">
                    {plan.LMNGA.toLocaleString()} {plan.MEINS}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`font-bold ${rateColor}`}>
                      {rate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        
        {plans.length === 0 && (
            <div className="p-10 text-center text-gray-500">
                데이터가 없습니다.
            </div>
        )}
      </div>
    </div>
  );
}