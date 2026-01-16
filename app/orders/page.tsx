import { getLatestOrders } from '@/actions/order-actions';
import { format } from 'date-fns'; // 날짜 포맷팅 라이브러리 활용

export default async function OrdersPage() {
  // 1. 서버에서 데이터 즉시 로드 (await)
  const orders = await getLatestOrders();

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-800">📦 최근 주문 현황 (SAP)</h1>
        <span className="text-sm text-gray-500">
          총 {orders.length}건 조회됨
        </span>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
        <table className="w-full text-sm text-left text-gray-600">
          <thead className="bg-gray-50 text-gray-700 uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">주문번호</th>
              <th className="px-6 py-3">거래처명</th>
              <th className="px-6 py-3">주문유형</th>
              <th className="px-6 py-3">창고(물류)</th>
              <th className="px-6 py-3">납품요청일</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
                // 날짜 포맷팅: 20251101 -> 2025-11-01
                const formattedDate = 
                  order.VDATU.length === 8 
                  ? `${order.VDATU.slice(0, 4)}-${order.VDATU.slice(4, 6)}-${order.VDATU.slice(6, 8)}`
                  : order.VDATU;

                return (
                <tr key={`${order.VBELN}-${order.POSNR}`} className="border-b hover:bg-gray-50 transition">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {order.VBELN}
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">{order.NAME1}</div>
                    <div className="text-xs text-gray-400">{order.KUNNR}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                      {order.BEZEI_TVAKT}
                    </span>
                  </td>
                  <td className="px-6 py-4">{order.LGOBE}</td>
                  <td className="px-6 py-4 font-mono text-gray-500">
                    {formattedDate}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        
        {orders.length === 0 && (
            <div className="p-10 text-center text-gray-500">
                데이터가 없습니다.
            </div>
        )}
      </div>
    </div>
  );
}