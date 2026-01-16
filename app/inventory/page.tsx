import { getInventoryStatus } from '@/actions/inventory-actions';

export default async function InventoryPage() {
  const items = await getInventoryStatus();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">📦 실시간 재고 현황</h1>
        <span className="text-sm text-gray-500">총 {items.length}개 품목</span>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
        <table className="w-full text-sm text-left text-gray-600">
          <thead className="bg-gray-50 text-gray-700 uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">품목 정보 (코드/명)</th>
              <th className="px-6 py-3">보관 창고</th>
              <th className="px-6 py-3 text-right">가용 재고</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.MATNR}-${item.LGORT}-${index}`} className="border-b hover:bg-gray-50">
                <td className="px-6 py-4">
                  <div className="font-bold text-gray-900">{item.MATNR_T}</div>
                  <div className="text-xs text-gray-400 font-mono">{item.MATNR}</div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-gray-900">{item.LGOBE}</div>
                  <div className="text-xs text-gray-400 font-mono">{item.LGORT}</div>
                </td>
                <td className="px-6 py-4 text-right font-medium text-blue-600">
                  {item.CLABS.toLocaleString()} 개
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {items.length === 0 && (
            <div className="p-10 text-center text-gray-500">
                데이터가 없습니다.
            </div>
        )}
      </div>
    </div>
  );
}