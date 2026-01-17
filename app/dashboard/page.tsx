import { getDashboardData } from '@/actions/dashboard-actions';
import { format, startOfMonth } from 'date-fns';
import DashboardClientUserInterface from '@/components/dashboard-ui';

// ✅ This is a Server Component
export default async function DashboardPage() {
  // 1. 서버 시간 기준으로 초기 조회 기간 설정
  const today = new Date();
  const startDate = format(startOfMonth(today), 'yyyy-MM-dd');
  const endDate = format(today, 'yyyy-MM-dd');

  // 2. 서버 사이드에서 데이터 즉시 조회 (DB Direct Call)
  // 클라이언트에서 useEffect로 부르던 것을 여기서 미리 실행합니다.
  const initialDataRes = await getDashboardData(startDate, endDate);
  const initialData = initialDataRes.success ? initialDataRes.data : null;

  return (
    <main>
      {/* 3. 준비된 데이터를 클라이언트 컴포넌트에 '도시락'처럼 전달 */}
      <DashboardClientUserInterface 
        initialData={initialData} 
      />
    </main>
  );
}