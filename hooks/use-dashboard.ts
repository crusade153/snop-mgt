import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { useDateStore } from '@/store/date-store'; 
import { DashboardAnalysis } from '@/types/analysis';
import { useCallback } from 'react';

export function useDashboardData(initialData?: DashboardAnalysis) {
  const queryClient = useQueryClient();
  const { startDate, endDate, setRange } = useDateStore();

  // ✅ [핵심] 제네릭 타입 <DashboardAnalysis> 명시로 데이터 타입 보장
  const query = useQuery<DashboardAnalysis>({
    queryKey: ['dashboard', startDate, endDate],
    queryFn: async () => {
      const res = await getDashboardData(startDate, endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    initialData: initialData, 
    staleTime: 1000 * 60 * 5, 
    refetchOnWindowFocus: false,
  });

  const refetch = useCallback(() => {
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
    isLoading: query.isFetching,
    isError: query.isError,
    dateRange: { startDate, endDate }, 
    setDateRange, 
    refetch
  };
}