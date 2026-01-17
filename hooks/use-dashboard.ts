import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { format, startOfMonth } from 'date-fns';
import { useState } from 'react';

export function useDashboardData() {
  // 기본 날짜 설정: 이번 달 1일 ~ 오늘
  const [dateRange, setDateRange] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // ✅ React Query 사용: 캐시 키 ['dashboard', 날짜]가 같으면 서버 요청 안 함
  const query = useQuery({
    queryKey: ['dashboard', dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      const res = await getDashboardData(dateRange.startDate, dateRange.endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    staleTime: 1000 * 60 * 5, // 5분간 데이터 신선함 유지 (로딩 안 뜸)
    refetchOnWindowFocus: false, // 윈도우 포커스 시 재요청 방지
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    dateRange,
    setDateRange,
    refetch: query.refetch // 수동 갱신 기능
  };
}