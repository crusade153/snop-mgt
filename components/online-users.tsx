'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { useOnlineUsers, type OnlineUser } from '@/hooks/use-online-users';

/** 헤더용 컴팩트 배지. 호버하면 누가 접속 중인지 목록이 뜬다. */
export function OnlineUsersBadge() {
  const { users, count, connected } = useOnlineUsers();
  const [open, setOpen] = useState(false);

  if (!connected) return null;

  return (
    <div
      className="relative hidden sm:block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 cursor-default">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <Users size={13} />
        <span className="text-xs font-bold">{count}명</span>
      </div>

      {open && count > 0 && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-neutral-200 bg-white shadow-lg p-2 z-50">
          <div className="px-2 pb-2 text-[11px] font-bold text-neutral-400 border-b border-neutral-100">
            현재 접속자 {count}명
          </div>
          <ul className="max-h-64 overflow-y-auto pt-1">
            {users.map((user) => (
              <UserRow key={user.userId} user={user} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 메인(종합 현황) 화면 상단용 패널. 인원수와 함께 누가 보고 있는지까지 보여준다. */
export function OnlineUsersPanel() {
  const { users, count, connected } = useOnlineUsers();

  if (!connected) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-2.5">
      <div className="flex items-center gap-2 shrink-0">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        <Users size={16} className="text-emerald-600" />
        <span className="text-sm font-bold text-emerald-800 whitespace-nowrap">
          현재 {count}명 접속 중
        </span>
      </div>

      <ul className="flex flex-wrap gap-1 border-l border-emerald-200 pl-3">
        {users.map((user) => (
          <li
            key={user.userId}
            className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-emerald-800 border border-emerald-200"
            title={user.team || undefined}
          >
            {user.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UserRow({ user }: { user: OnlineUser }) {
  return (
    <li className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-neutral-50">
      <span className="text-xs font-medium text-neutral-700 truncate">{user.name}</span>
      <span className="text-[10px] text-neutral-400 shrink-0">{user.team}</span>
    </li>
  );
}
