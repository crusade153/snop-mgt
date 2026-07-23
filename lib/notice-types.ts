// 클라이언트 컴포넌트에서도 import 하므로 서버 전용 모듈(next/headers 등)을 넣지 않는다.

export type NoticeLevel = "info" | "warning" | "critical";
export type NoticeFrequency = "daily" | "always";

export type NoticeRecord = {
  id: string;
  title: string;
  body: string;
  level: NoticeLevel;
  frequency: NoticeFrequency;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

/** 팝업에 내려보내는 최소 정보. 공지 본문 외에는 아무것도 담지 않는다. */
export type PublicNotice = {
  id: string;
  title: string;
  body: string;
  level: NoticeLevel;
  frequency: NoticeFrequency;
  updatedAt: string;
};

export const NOTICE_LEVELS: { value: NoticeLevel; label: string }[] = [
  { value: "info", label: "안내" },
  { value: "warning", label: "주의" },
  { value: "critical", label: "필수" },
];

export const NOTICE_FREQUENCIES: { value: NoticeFrequency; label: string; hint: string }[] = [
  { value: "daily", label: "하루 1회", hint: "닫으면 그날은 다시 뜨지 않습니다." },
  { value: "always", label: "접속할 때마다", hint: "화면에 들어올 때마다 매번 뜹니다." },
];
