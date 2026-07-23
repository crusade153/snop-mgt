'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Info, ShieldAlert, X } from 'lucide-react';
import type { NoticeLevel, PublicNotice } from '@/lib/notice-types';

const levelStyles: Record<NoticeLevel, { badge: string; bar: string; icon: typeof Info; label: string }> = {
  info: {
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    bar: 'bg-blue-600',
    icon: Info,
    label: '안내',
  },
  warning: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    bar: 'bg-amber-500',
    icon: AlertTriangle,
    label: '주의',
  },
  critical: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    bar: 'bg-[#E53935]',
    icon: ShieldAlert,
    label: '필수',
  },
};

/** 하루 1회 판정용 키. updatedAt 을 포함시켜 공지를 수정하면 다시 뜨게 한다. */
function seenKey(notice: PublicNotice) {
  const today = new Date().toISOString().slice(0, 10);
  return `notice:${notice.id}:${notice.updatedAt}:${today}`;
}

export default function NoticePopup({
  preview,
  onClose,
}: {
  preview?: PublicNotice | null;
  onClose?: () => void;
}) {
  const [notice, setNotice] = useState<PublicNotice | null>(preview ?? null);
  const [open, setOpen] = useState(Boolean(preview));

  useEffect(() => {
    if (preview !== undefined) {
      setNotice(preview);
      setOpen(Boolean(preview));
      return;
    }

    let active = true;

    fetch('/api/notice', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : { notice: null }))
      .then((data: { notice: PublicNotice | null }) => {
        if (!active || !data?.notice) return;

        const next = data.notice;

        // '접속할 때마다'는 무조건, '하루 1회'는 오늘 닫은 기록이 없을 때만 띄운다.
        if (next.frequency === 'daily') {
          try {
            if (window.localStorage.getItem(seenKey(next))) return;
          } catch {
            // localStorage 를 못 쓰는 환경이면 그냥 띄운다.
          }
        }

        setNotice(next);
        setOpen(true);
      })
      .catch(() => {
        // 공지 조회 실패가 로그인 자체를 막아서는 안 된다.
      });

    return () => {
      active = false;
    };
  }, [preview]);

  const handleClose = () => {
    if (notice && notice.frequency === 'daily' && preview === undefined) {
      try {
        window.localStorage.setItem(seenKey(notice), '1');
      } catch {
        // 무시
      }
    }
    setOpen(false);
    onClose?.();
  };

  if (!open || !notice) return null;

  const style = levelStyles[notice.level] ?? levelStyles.warning;
  const Icon = style.icon;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        <div className={`h-1.5 w-full ${style.bar}`} />

        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg border ${style.badge}`}>
              <Icon size={18} />
            </div>
            <div>
              <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>
                {style.label}
              </span>
              <h2 className="mt-1.5 text-lg font-bold leading-snug text-neutral-950">
                {notice.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="공지 닫기"
            className="shrink-0 rounded p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-6 py-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
            {notice.body}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-100 bg-neutral-50 px-6 py-4">
          <span className="text-xs text-neutral-400">
            {notice.frequency === 'daily' ? '이 공지는 하루에 한 번 표시됩니다.' : '이 공지는 접속할 때마다 표시됩니다.'}
          </span>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg bg-[#212121] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#E53935]"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
