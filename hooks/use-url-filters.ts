'use client';

import { useCallback } from 'react';
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
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const copyShareUrl = useCallback(() => {
    const url = `${window.location.origin}${pathname}?${searchParams.toString()}`;
    navigator.clipboard.writeText(url).then(() => {
      alert('현재 뷰 링크가 클립보드에 복사되었습니다.');
    });
  }, [pathname, searchParams]);

  return { getParam, getIntParam, setParams, copyShareUrl, searchParams };
}
