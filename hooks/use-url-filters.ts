'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * URL SearchParams 기반 필터 상태 훅
 * - 필터 변경 시 router.replace로 URL 업데이트 (히스토리 미적재)
 * - 새로고침·링크 공유 후에도 필터 상태 유지
 */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();

  /**
   * 한 이벤트 안에서 setParams 를 두 번 호출하면 두 번째가 첫 번째를 지워버렸다.
   * router.replace 는 비동기라 그 사이 searchParams 가 갱신되지 않는데,
   * 매번 렌더 시점의 searchParams 로 새로 만들었기 때문이다.
   *
   *   setSelectedPlant('1021');  // ?plant=1021
   *   setCurrentPage(1);         // 같은 빈 값 기준으로 다시 만들어 plant 가 사라짐
   *
   * 그래서 마지막으로 쓴 쿼리스트링을 기억해 두고 그 위에 얹는다.
   */
  const pendingRef = useRef(searchString);

  useEffect(() => {
    // 실제 URL 이 바뀌면(뒤로가기·링크 이동 포함) 기준값을 다시 맞춘다.
    pendingRef.current = searchString;
  }, [searchString]);

  const getParam = useCallback(
    (key: string, fallback = '') => searchParams.get(key) ?? fallback,
    [searchParams]
  );

  const getIntParam = useCallback(
    (key: string, fallback = 1) => {
      const v = searchParams.get(key);
      const n = v ? parseInt(v, 10) : NaN;
      return isNaN(n) ? fallback : n;
    },
    [searchParams]
  );

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(pendingRef.current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      pendingRef.current = params.toString();
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname]
  );

  const copyShareUrl = useCallback(() => {
    const url = `${window.location.origin}${pathname}?${searchParams.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      alert('현재 뷰 링크가 클립보드에 복사되었습니다.');
    });
  }, [pathname, searchParams]);

  return { getParam, getIntParam, setParams, copyShareUrl, searchParams };
}
