'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // QueryClient를 한 번만 생성하여 유지합니다.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 데이터를 5분(300초) 동안은 '상한 것'으로 취급하지 않음 (재요청 안 함)
            staleTime: 1000 * 60 * 5, 
            // 탭을 다시 눌렀을 때 자동으로 다시 가져오지 않음 (수동 조회를 원칙으로)
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}