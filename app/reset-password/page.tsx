"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, ShieldCheck } from "lucide-react";

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      ),
    [],
  );

  useEffect(() => {
    const restoreRecoverySession = async () => {
      setError(null);

      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          setReady(false);
          return;
        }
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setError(sessionError.message);
          setReady(false);
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      setReady(Boolean(session));
      if (!session) {
        setError("비밀번호 재설정 링크가 만료되었거나 올바르지 않습니다. 관리자에게 재설정 메일 재발송을 요청해주세요.");
      }
    };

    restoreRecoverySession();
  }, [searchParams, supabase]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (password.length < 8) {
      setError("비밀번호는 8자 이상으로 입력해주세요.");
      return;
    }

    if (password !== confirmPassword) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 다시 로그인해주세요.");
    await supabase.auth.signOut();
    setTimeout(() => router.replace("/login"), 1200);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4">
      <div className="w-full max-w-md rounded border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded bg-red-50 text-red-600">
          <KeyRound size={24} />
        </div>
        <h1 className="mt-5 text-center text-2xl font-bold text-neutral-950">
          비밀번호 재설정
        </h1>
        <p className="mt-2 text-center text-sm leading-6 text-neutral-500">
          새 비밀번호를 입력하면 기존 비밀번호는 더 이상 사용할 수 없습니다.
        </p>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="mt-5 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-700">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-neutral-700">
              새 비밀번호
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={!ready || loading}
              className="h-11 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:bg-neutral-100"
              placeholder="8자 이상 입력"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold text-neutral-700">
              새 비밀번호 확인
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={!ready || loading}
              className="h-11 w-full rounded border border-neutral-300 px-3 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100 disabled:bg-neutral-100"
              placeholder="한 번 더 입력"
            />
          </div>

          <button
            type="submit"
            disabled={!ready || loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded bg-neutral-950 text-sm font-bold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {loading ? "변경 중..." : "비밀번호 변경"}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>
      </div>
    </div>
  );
}
