import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { format, startOfMonth } from 'date-fns';
import { useState } from 'react';
import { DashboardAnalysis } from '@/types/analysis';

// 초기 데이터 타입을 받도록 수정
export function useDashboardData(initialData?: DashboardAnalysis) {
  // 1. [UI용] 날짜 상태
  const [dateRange, setDateRange] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
  });

  // 2. [쿼리용] 실제 API 요청에 사용되는 날짜
  const [queryDate, setQueryDate] = useState({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const query = useQuery({
    queryKey: ['dashboard', queryDate.startDate, queryDate.endDate],
    queryFn: async () => {
      const res = await getDashboardData(queryDate.startDate, queryDate.endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    // ✅ 핵심: 서버에서 가져온 초기 데이터가 있으면 바로 사용!
    initialData: initialData, 
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const onSearch = () => {
    setQueryDate({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate
    });
  };

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    dateRange,
    setDateRange,
    refetch: onSearch
  };
}