import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDashboardData } from '@/actions/dashboard-actions';
import { useDateStore } from '@/store/date-store'; // 전역 스토어 import
import { DashboardAnalysis } from '@/types/analysis';
import { useCallback } from 'react'; // ✅ useCallback 추가

// 초기 데이터 타입을 받도록 수정
export function useDashboardData(initialData?: DashboardAnalysis) {
  const queryClient = useQueryClient();
  
  // 전역 스토어에서 날짜 가져오기 (모든 컴포넌트가 이 날짜를 공유함)
  const { startDate, endDate, setRange } = useDateStore();

  const query = useQuery({
    // 쿼리 키에 날짜 포함 -> 날짜 바뀌면 자동 페칭
    queryKey: ['dashboard', startDate, endDate],
    queryFn: async () => {
      const res = await getDashboardData(startDate, endDate);
      if (!res.success) throw new Error(res.message);
      return res.data;
    },
    // 서버에서 가져온 초기 데이터가 있으면 바로 사용
    initialData: initialData, 
    staleTime: 1000 * 60 * 5, // 5분
    refetchOnWindowFocus: false,
  });

  // 강제 새로고침 함수 (조회 버튼용) - useCallback으로 안정화
  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }, [queryClient]);

  // ✅ [핵심 수정] 함수 재생성 방지를 위해 useCallback 사용
  // useDateStore.getState()를 사용하여 의존성 배열에서 startDate/endDate 제거 (무한루프 방지)
  const setDateRange = useCallback((newRange: any) => {
    // 현재 스토어의 값을 직접 가져옴 (구독하지 않음)
    const currentStart = useDateStore.getState().startDate;
    const currentEnd = useDateStore.getState().endDate;

    // 기존 UI가 객체나 함수형 업데이트를 쓸 수 있으므로 처리
    if (typeof newRange === 'function') {
        const res = newRange({ startDate: currentStart, endDate: currentEnd });
        setRange(res.startDate, res.endDate);
    } else {
        setRange(newRange.startDate, newRange.endDate);
    }
  }, [setRange]); // setRange는 Zustand에서 제공하므로 안정적임

  return {
    data: query.data,
    isLoading: query.isFetching, // isLoading 대신 isFetching 사용 (재조회 상태 표시)
    isError: query.isError,
    // UI 호환성을 위해 리턴 구조 유지
    dateRange: { startDate, endDate }, 
    setDateRange, // ✅ 이제 이 함수는 렌더링 간에 변하지 않습니다.
    refetch
  };
}