'use client';

/**
 * Supabase Realtime Presence 로 현재 접속자를 집계한다.
 *
 * 별도 테이블에 heartbeat 를 쓰는 방식은 탭을 강제 종료했을 때 유령 접속자가 남고
 * 정리용 크론이 필요해진다. Presence 는 웹소켓이 끊기면 서버가 알아서 빼주므로
 * "지금 열려 있는 화면 수"를 그대로 반영한다.
 *
 * 같은 사람이 탭을 여러 개 열어도 1명으로 세도록 presence key 를 user id 로 잡는다.
 */
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export interface OnlineUser {
  userId: string;
  name: string;
  team: string;
  /** 이 사람이 열어둔 화면 수 */
  tabs: number;
}

interface MeResponse {
  signedIn: boolean;
  userId?: string;
  name?: string;
  team?: string;
}

const CHANNEL = 'snop-online-users';

export function useOnlineUsers() {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      let me: MeResponse;
      try {
        const response = await fetch('/api/me', { cache: 'no-store' });
        me = await response.json();
      } catch {
        return;
      }

      // 로그인 전(로그인/승인대기 화면)에는 채널에 붙지 않는다.
      if (cancelled || !me.signedIn || !me.userId) return;

      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const channel = supabase.channel(CHANNEL, {
        config: { presence: { key: me.userId } },
      });

      const syncUsers = () => {
        const state = channel.presenceState<{ name: string; team: string }>();
        const next: OnlineUser[] = Object.entries(state).map(([userId, presences]) => ({
          userId,
          name: presences[0]?.name || '사용자',
          team: presences[0]?.team || '',
          tabs: presences.length,
        }));
        next.sort((a, b) => a.name.localeCompare(b.name));
        setUsers(next);
      };

      channel
        .on('presence', { event: 'sync' }, syncUsers)
        .on('presence', { event: 'join' }, syncUsers)
        .on('presence', { event: 'leave' }, syncUsers)
        .subscribe(async (status) => {
          if (status !== 'SUBSCRIBED') {
            if (!cancelled) setConnected(false);
            return;
          }
          await channel.track({ name: me.name, team: me.team });
          if (!cancelled) setConnected(true);
        });

      cleanup = () => {
        channel.unsubscribe();
        supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return { users, count: users.length, connected };
}
