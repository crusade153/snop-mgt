import { getDashboardData } from '@/actions/dashboard-actions';
import { getDailyWatchReport } from '@/actions/daily-actions'; // ✅ 추가
import { format, startOfMonth } from 'date-fns';
import DashboardClientUserInterface from '@/components/dashboard-ui';

export default async function DashboardPage() {
  const today = new Date();
  const startDate = format(startOfMonth(today), 'yyyy-MM-dd');
  const endDate = format(today, 'yyyy-MM-dd');

  // 병렬로 데이터 조회 (기존 대시보드 데이터 + 일일 관리 데이터)
  const [initialDataRes, dailyReportRes] = await Promise.all([
    getDashboardData(startDate, endDate),
    getDailyWatchReport()
  ]);

  const initialData = initialDataRes.success ? initialDataRes.data : null;
  const dailyAlerts = dailyReportRes.success ? dailyReportRes.data : []; // ✅ 데이터 확보

  return (
    <main>
      <DashboardClientUserInterface 
        initialData={initialData} 
        dailyAlerts={dailyAlerts} // ✅ 클라이언트 UI로 전달
      />
    </main>
  );
}