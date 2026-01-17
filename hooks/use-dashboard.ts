// hooks/use-dashboard.ts

import { useQuery } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { format, startOfMonth } from 'date-fns';
import { useState } from 'react';

export function useDashboardData() {
  // 1. [UI용] 입력 필드에 바인딩되는 날짜 (변경해도 API 호출 안 됨)
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
    // 3. queryKey는 입력값이 아닌 'queryDate'를 바라보게 수정
    queryKey: ['dashboard', queryDate.startDate, queryDate.endDate],
    queryFn: async () => {
      // API 호출 시에도 queryDate를 사용
      const res = await getDashboardData(queryDate.startDate, queryDate.endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  // 4. [조회 버튼 동작] UI 날짜를 쿼리 날짜로 덮어씌움 -> React Query가 감지하고 자동 fetch
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
    dateRange,      // UI(Input)에 연결
    setDateRange,   // UI(Input) 변경용
    refetch: onSearch // 기존 refetch 대신 onSearch 함수를 반환 (이름은 refetch로 유지하여 기존 코드 호환성 확보)
  };
}