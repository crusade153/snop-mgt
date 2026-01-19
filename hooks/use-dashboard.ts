import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { useDateStore } from '@/store/date-store'; 
import { DashboardAnalysis } from '@/types/analysis';
import { useCallback } from 'react';
import { format, startOfMonth } from 'date-fns';

export function useDashboardData(initialData?: DashboardAnalysis) {
  const queryClient = useQueryClient();
  const { startDate, endDate, setRange } = useDateStore();

  // ✅ [수정] 현재 날짜가 '초기 날짜(이번달 1일 ~ 오늘)'와 같은지 확인
  // 날짜가 바뀌었다면 initialData를 무시하고 새로 가져오기 위함
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const startOfMonthStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');
  const isDefaultRange = startDate === startOfMonthStr && endDate === todayStr;

  const query = useQuery<DashboardAnalysis>({
    queryKey: ['dashboard', startDate, endDate],
    queryFn: async () => {
      const res = await getDashboardData(startDate, endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    // 🚨 [핵심] 날짜가 기본 범위일 때만 initialData 사용. 아니면 undefined 처리하여 로딩 유발
    initialData: isDefaultRange ? initialData : undefined, 
    staleTime: 1000 * 60 * 5, 
    refetchOnWindowFocus: false,
  });

  const refetch = useCallback(() => {
    // 🚨 강제로 무효화해서 다시 가져오기
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [queryClient]);

  const setDateRange = useCallback((newRange: any) => {
    const currentStart = useDateStore.getState().startDate;
    const currentEnd = useDateStore.getState().endDate;

    if (typeof newRange === 'function') {
        const res = newRange({ startDate: currentStart, endDate: currentEnd });
        setRange(res.startDate, res.endDate);
    } else {
        setRange(newRange.startDate, newRange.endDate);
    }
  }, [setRange]);

  return {
    data: query.data,
    isLoading: query.isFetching, // isFetching을 써야 재조회 시 로딩 표시됨
    isError: query.isError,
    dateRange: { startDate, endDate }, 
    setDateRange, 
    refetch
  };
}