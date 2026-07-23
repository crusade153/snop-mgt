'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { Database, Truck, Factory, Package, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';
import NoticePopup from '@/components/notice-popup';
import { requestAccount, signInWithPin } from './actions';

const emptySignup = {
  fullName: '',
  team: '',
  companyEmail: '',
  loginId: '',
  pin: '',
  pinConfirm: '',
};

export default function LoginPage() {
  const [loginId, setLoginId] = useState('');
  const [pin, setPin] = useState('');
  const [signup, setSignup] = useState(emptySignup);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await signInWithPin(loginId, pin);

      if (!result.ok) {
        setError(result.message);
        setPin('');
        return;
      }

      router.refresh();
      router.replace(result.redirectTo ?? '/dashboard');
    } catch (err: any) {
      console.error('Auth Error:', err);
      setError(err?.message || '로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (signup.pin !== signup.pinConfirm) {
      setError('PIN이 서로 일치하지 않습니다.');
      return;
    }

    setLoading(true);

    try {
      const result = await requestAccount({
        fullName: signup.fullName,
        team: signup.team,
        companyEmail: signup.companyEmail,
        loginId: signup.loginId,
        pin: signup.pin,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      setSuccess(result.message);
      setLoginId(signup.loginId.trim().toLowerCase());
      setSignup(emptySignup);
      setMode('login');
    } catch (err: any) {
      console.error('Signup Error:', err);
      setError(err?.message || '가입 신청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'signup' : 'login');
    setError(null);
    setSuccess(null);
    setPin('');
  };

  return (
    <div className="flex min-h-screen w-full bg-neutral-100">
      {/* 접속이 막힌 사용자도 볼 수 있어야 하므로 로그인 화면에 공지를 띄운다 */}
      <NoticePopup />

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
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 bg-white overflow-y-auto">
        <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 py-8">

          <div className="text-center">
            <h2 className="text-2xl font-bold text-neutral-900">
              {mode === 'login' ? '시스템 접속' : '가입 신청'}
            </h2>
            <p className="text-sm text-neutral-500 mt-2">
              {mode === 'login'
                ? '로그인 ID와 PIN 6자리를 입력해주세요.'
                : '팀·이름을 확인한 뒤 관리자가 승인합니다.'}
            </p>
          </div>

          {error && (
            <div className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-4 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <Field label="로그인 ID">
                <input
                  type="text"
                  required
                  autoComplete="username"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className={inputClass}
                  placeholder="발급받은 로그인 ID"
                />
              </Field>

              <Field label="PIN (숫자 6자리)">
                <input
                  type="password"
                  required
                  inputMode="numeric"
                  autoComplete="current-password"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className={`${inputClass} tracking-[0.5em] text-lg`}
                  placeholder="••••••"
                />
              </Field>

              <SubmitButton loading={loading} label="로그인 (Login)" />
            </form>
          ) : (
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="이름">
                  <input
                    type="text"
                    required
                    value={signup.fullName}
                    onChange={(e) => setSignup({ ...signup, fullName: e.target.value })}
                    className={inputClass}
                    placeholder="홍길동"
                  />
                </Field>
                <Field label="팀">
                  <input
                    type="text"
                    required
                    value={signup.team}
                    onChange={(e) => setSignup({ ...signup, team: e.target.value })}
                    className={inputClass}
                    placeholder="원가관리팀"
                  />
                </Field>
              </div>

              <Field label="회사 이메일">
                <input
                  type="email"
                  required
                  value={signup.companyEmail}
                  onChange={(e) => setSignup({ ...signup, companyEmail: e.target.value })}
                  className={inputClass}
                  placeholder="XXXXXX@harim-foods.com"
                />
              </Field>

              <Field label="로그인 ID" hint="영문 소문자·숫자 3~20자">
                <input
                  type="text"
                  required
                  value={signup.loginId}
                  onChange={(e) => setSignup({ ...signup, loginId: e.target.value.toLowerCase() })}
                  className={inputClass}
                  placeholder="접속할 때 사용할 ID"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="PIN 6자리">
                  <input
                    type="password"
                    required
                    inputMode="numeric"
                    maxLength={6}
                    value={signup.pin}
                    onChange={(e) => setSignup({ ...signup, pin: e.target.value.replace(/\D/g, '') })}
                    className={`${inputClass} tracking-[0.4em]`}
                    placeholder="••••••"
                  />
                </Field>
                <Field label="PIN 확인">
                  <input
                    type="password"
                    required
                    inputMode="numeric"
                    maxLength={6}
                    value={signup.pinConfirm}
                    onChange={(e) => setSignup({ ...signup, pinConfirm: e.target.value.replace(/\D/g, '') })}
                    className={`${inputClass} tracking-[0.4em]`}
                    placeholder="••••••"
                  />
                </Field>
              </div>

              <p className="text-xs text-neutral-500 leading-relaxed">
                생일·전화번호처럼 추측하기 쉬운 번호는 피해주세요.
                연속(123456)이나 반복(111111) 숫자는 사용할 수 없습니다.
              </p>

              <SubmitButton loading={loading} label="가입 신청 (Sign Up)" />
            </form>
          )}

          <div className="pt-6 border-t border-neutral-100 text-center space-y-3">
            <p className="text-sm text-neutral-600">
              {mode === 'login' ? '아직 계정이 없으신가요?' : '이미 계정이 있으신가요?'}
            </p>
            <button
              onClick={switchMode}
              className="text-sm font-bold text-neutral-900 hover:text-[#E53935] transition-colors underline decoration-2 decoration-transparent hover:decoration-[#E53935]"
            >
              {mode === 'login' ? '가입 신청하기' : '로그인 화면으로 돌아가기'}
            </button>
            {mode === 'login' && (
              <p className="text-xs text-neutral-400 pt-2">
                PIN을 잊으셨나요? 관리자에게 재설정을 요청해주세요.
              </p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

const inputClass =
  'w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#E53935] focus:border-transparent transition-all placeholder:text-neutral-400';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-neutral-700 mb-1.5">
        {label}
        {hint && <span className="ml-2 text-xs font-normal text-neutral-400">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function SubmitButton({ loading, label }: { loading: boolean; label: string }) {
  return (
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
          {label}
          <ArrowRight size={18} />
        </>
      )}
    </button>
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
