'use client';

import { createBrowserClient } from '@supabase/ssr'; // 또는 사용 중인 client import
import { useRouter } from 'next/navigation';

export default function UnauthorizedPage() {
  const router = useRouter();
  
  const handleLogout = async () => {
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!, 
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <div className="w-16 h-16 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center mx-auto mb-4">
          🔒
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">승인 대기 중</h1>
        <p className="text-gray-600 mb-6">
          회원가입이 완료되었습니다.<br />
          관리자 승인 후 시스템을 이용하실 수 있습니다.
        </p>
        
        <div className="flex flex-col gap-3">
          <button 
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 transition"
          >
            승인 상태 확인 (새로고침)
          </button>
          <button 
            onClick={handleLogout}
            className="w-full bg-gray-200 text-gray-700 py-2 rounded hover:bg-gray-300 transition"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}