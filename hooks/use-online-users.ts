'use client';

/**
 * Supabase Realtime Presence 로 현재 접속자를 집계한다.
 *
 * 별도 테이블에 heartbeat 를 쓰는 방식은 탭을 강제 종료했을 때 유령 접속자가 남고
 * 정리용 크론이 필요해진다. Presence 는 웹소켓이 끊기면 서버가 알아서 빼주므로
 * "지금 열려 있는 화면 수"를 그대로 반영한다.
 *
 * ⚠️ 채널은 반드시 앱 전체에서 하나만 유지한다.
 *    훅을 쓰는 컴포넌트마다 채널을 만들면 같은 사람이 소켓 수만큼 중복 등록돼
 *    본인이 "×2" 로 세어지고, 페이지를 옮길 때마다 숫자가 튄다.
 *    (헤더 배지 + 대시보드 패널이 동시에 떠 있는 상황이 정확히 그랬다)
 *    그래서 모듈 레벨에 채널 하나를 두고 구독자 수만 세는 구조로 만든다.
 */
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export interface OnlineUser {
  userId: string;
  name: string;
  team: string;
}

export interface OnlineState {
  users: OnlineUser[];
  connected: boolean;
}

const CHANNEL = 'snop-online-users';

/** 라우팅 중 잠깐 구독자가 0이 되는 것만으로 연결을 끊지 않기 위한 유예 시간. */
const TEARDOWN_DELAY_MS = 3000;

let state: OnlineState = { users: [], connected: false };
const listeners = new Set<(next: OnlineState) => void>();

let client: SupabaseClient | null = null;
let channel: RealtimeChannel | null = null;
let subscriberCount = 0;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let starting = false;

function publish(next: OnlineState) {
  state = next;
  listeners.forEach((listener) => listener(state));
}

async function start() {
  if (channel || starting) return;
  starting = true;

  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    const me = await response.json();

    // 로그인 전(로그인/승인대기 화면)에는 채널에 붙지 않는다.
    if (!me?.signedIn || !me.userId) return;

    // 기다리는 사이에 마지막 구독자가 떠났으면 접속하지 않는다.
    if (subscriberCount === 0) return;

    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const nextChannel = client.channel(CHANNEL, {
      config: { presence: { key: me.userId } },
    });

    const sync = () => {
      const presenceState = nextChannel.presenceState<{ name: string; team: string }>();
      const users: OnlineUser[] = Object.entries(presenceState).map(([userId, presences]) => ({
        userId,
        name: presences[0]?.name || '사용자',
        team: presences[0]?.team || '',
      }));
      users.sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
      publish({ users, connected: true });
    };

    nextChannel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await nextChannel.track({ name: me.name, team: me.team });
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          publish({ users: [], connected: false });
        }
      });

    channel = nextChannel;
  } catch {
    publish({ users: [], connected: false });
  } finally {
    starting = false;
  }
}

function stop() {
  if (channel) {
    channel.unsubscribe();
    if (client) client.removeChannel(channel);
    channel = null;
  }
  client = null;
  publish({ users: [], connected: false });
}

export function useOnlineUsers() {
  const [local, setLocal] = useState<OnlineState>(state);

  useEffect(() => {
    listeners.add(setLocal);
    subscriberCount += 1;

    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = null;
    }
    void start();

    return () => {
      listeners.delete(setLocal);
      subscriberCount -= 1;

      // 페이지 이동으로 컴포넌트가 잠깐 사라지는 것과 실제 이탈을 구분한다.
      if (subscriberCount === 0 && !teardownTimer) {
        teardownTimer = setTimeout(() => {
          teardownTimer = null;
          if (subscriberCount === 0) stop();
        }, TEARDOWN_DELAY_MS);
      }
    };
  }, []);

  return { users: local.users, count: local.users.length, connected: local.connected };
}
