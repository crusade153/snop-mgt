'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { BarChart3, Database, Truck, Factory, Package, ArrowRight, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const router = useRouter();

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    const initSession = async () => {
      await supabase.auth.signOut();
    };
    initSession();
  }, [supabase]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: email.split('@')[0] }
          }
        });
        if (error) throw error;
        alert('회원가입이 완료되었습니다! 관리자 승인을 기다려주세요.');
        setMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.refresh();
        router.replace('/dashboard');
      }
    } catch (err: any) {
      console.error('Auth Error:', err);
      if (err.message?.includes('Anonymous')) {
        setError('세션 오류가 발생했습니다. 페이지를 새로고침해주세요.');
      } else {
        setError(err.message || '로그인 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-neutral-100">
      {/* 1. Left Side: Brand & Intro */}
      <div className="hidden lg:flex w-1/2 bg-[#212121] text-white flex-col justify-between p-12 relative overflow-hidden">
        {/* Background Patterns */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#E53935] opacity-10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-600 opacity-10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

        {/* Top Logo */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-[#E53935] rounded-lg flex items-center justify-center font-bold text-lg">H</div>
          <div>
            <div className="font-bold text-xl leading-none">HARIM</div>
            <div className="text-xs text-neutral-400">Harim Industry Co., Ltd.</div>
          </div>
        </div>

        {/* Main Content */}
        <div className="relative z-10 space-y-8 max-w-lg">
          <div>
            <span className="inline-block px-3 py-1 rounded-full bg-[#E53935]/20 text-[#FF8A80] text-xs font-bold border border-[#E53935]/30 mb-4">
              Beta v2.0
            </span>
            <h1 className="text-5xl font-bold leading-tight mb-4">
              Biz-Control<br/>Tower
            </h1>
            <p className="text-neutral-400 text-lg leading-relaxed">
              SAP 데이터(SD/MM/PP)와 BigQuery를 연동하여<br/>
              실시간 S&OP 의사결정을 지원하는 통합 플랫폼입니다.
            </p>
          </div>

          <div className="space-y-4">
            <FeatureRow icon={Truck} title="Sales & Distribution (SD)" desc="주문, 납품, 미납 현황 실시간 추적" />
            <FeatureRow icon={Package} title="Material Management (MM)" desc="재고 수불, 유통기한, 폐기 리스크 분석" />
            <FeatureRow icon={Factory} title="Production Planning (PP)" desc="생산 계획 대비 실적 및 달성률 모니터링" />
            <FeatureRow icon={Database} title="BigQuery Integration" desc="대용량 ERP 데이터 초고속 쿼리 처리" />
          </div>
        </div>

        {/* Footer */}
        <div className="relative z-10 text-xs text-neutral-500">
          © 2026 Powered by Kdyu. All rights reserved.
        </div>
      </div>

      {/* 2. Right Side: Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          
          <div className="text-center">
            <h2 className="text-2xl font-bold text-neutral-900">
              {mode === 'login' ? '시스템 접속' : '계정 생성'}
            </h2>
            <p className="text-sm text-neutral-500 mt-2">
              {mode === 'login' 
                ? '승인된 이메일 계정으로 로그인해주세요.' 
                : '사내 이메일(@harim-foods.com)을 사용해주세요.'}
            </p>
          </div>

          {error && (
            <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold text-neutral-700 mb-1.5">이메일</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E53935] focus:border-transparent transition-all placeholder:text-neutral-400"
                placeholder="XXXXXX@harim-foods.com" 
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-neutral-700 mb-1.5">비밀번호</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E53935] focus:border-transparent transition-all placeholder:text-neutral-400"
                placeholder="8자 이상 입력"
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3.5 text-white font-bold rounded-lg transition-all duration-200 flex items-center justify-center gap-2
                ${loading 
                  ? 'bg-neutral-400 cursor-not-allowed' 
                  : 'bg-[#212121] hover:bg-[#E53935] hover:shadow-lg active:scale-[0.98]'
                }`}
            >
              {loading ? '처리 중...' : (
                <>
                  {mode === 'login' ? '로그인 (Login)' : '가입 요청 (Sign Up)'}
                  {!loading && <ArrowRight size={18} />}
                </>
              )}
            </button>
          </form>

          <div className="pt-6 border-t border-neutral-100 text-center">
            <p className="text-sm text-neutral-600 mb-3">
              {mode === 'login' ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?'}
            </p>
            <button 
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError(null);
                setEmail('');
                setPassword('');
              }}
              className="text-sm font-bold text-neutral-900 hover:text-[#E53935] transition-colors underline decoration-2 decoration-transparent hover:decoration-[#E53935]"
            >
              {mode === 'login' ? '회원가입 신청하기' : '로그인 화면으로 돌아가기'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

// 왼쪽 영역에 들어갈 기능 소개 컴포넌트
function FeatureRow({ icon: Icon, title, desc }: any) {
  return (
    <div className="flex items-start gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors">
      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0 text-white">
        <Icon size={20} />
      </div>
      <div>
        <div className="font-bold text-white text-sm mb-0.5">{title}</div>
        <div className="text-xs text-neutral-400">{desc}</div>
      </div>
    </div>
  );
}