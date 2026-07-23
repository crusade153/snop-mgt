/**
 * 초기 관리자 계정 + 재가입 안내 공지를 생성한다.
 *
 *   node scripts/seed-admin.mjs
 *
 * 전제:
 *   - supabase/auth-renewal.sql, supabase/notices.sql 실행 완료
 *   - .env.local 에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 존재
 *
 * 이미 같은 로그인 ID/이메일이 있으면 PIN 과 프로필만 갱신한다(재실행 안전).
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ADMIN = {
  loginId: "admin",
  fullName: "유경덕",
  team: "원가관리팀",
  // 표시·연락용. auth 계정 식별자로는 쓰지 않는다.
  companyEmail: "yukd2022@harim-foods.com",
  // 이 Supabase 프로젝트의 auth.users 는 다른 대시보드(public.members)와 공유된다.
  // 회사 이메일을 쓰면 그쪽 계정의 비밀번호까지 덮어쓰게 되므로 내부 전용 주소를 쓴다.
  authEmail: "admin@snop.local",
  pin: "255611",
};

const NOTICE = {
  title: "[필수] 보안 정책 변경에 따른 계정 재등록 안내",
  body: `계정 보안 강화 및 퇴사자·장기 미사용 계정 정리를 위해 기존 계정을 모두 초기화했습니다.
기존 이메일·비밀번호로는 접속할 수 없습니다.

아래 절차로 다시 등록해 주세요.
1. 로그인 화면의 [가입 신청] 클릭
2. 이름 · 팀 · 회사 이메일 · 로그인 ID · PIN 6자리 입력
3. 관리자 승인 후 이용 가능

PIN은 앞으로 관리자가 즉시 재설정해 드릴 수 있습니다.
문의: 원가관리팀 유경덕 (yukd2022@harim-foods.com)`,
  level: "critical",
  // 재가입 안내는 놓치면 접속 자체를 못 하므로 접속할 때마다 띄운다.
  frequency: "always",
};

function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env.local 이 없으면 실제 환경변수를 그대로 쓴다.
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;

if (!url || !serviceKey) {
  console.error(
    "❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.\n" +
      "   Supabase Dashboard → Project Settings → API → service_role 키를 .env.local 에 추가해주세요.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findExistingUser(email) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function seedAdmin() {
  let user = await findExistingUser(ADMIN.authEmail);

  if (user) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      password: ADMIN.pin,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    console.log(`↻ 기존 관리자 계정의 PIN을 재설정했습니다: ${ADMIN.authEmail}`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN.authEmail,
      password: ADMIN.pin,
      email_confirm: true,
      user_metadata: {
        full_name: ADMIN.fullName,
        team: ADMIN.team,
        login_id: ADMIN.loginId,
      },
    });
    if (error) throw new Error(error.message);
    user = data.user;
    console.log(`✔ 관리자 계정을 생성했습니다: ${ADMIN.authEmail}`);
  }

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      login_id: ADMIN.loginId,
      full_name: ADMIN.fullName,
      team: ADMIN.team,
      company_email: ADMIN.companyEmail,
      auth_email: ADMIN.authEmail,
      email: ADMIN.companyEmail,
      role: "admin",
      status: "active",
      failed_attempts: 0,
      locked_until: null,
    },
    { onConflict: "id" },
  );

  if (profileError) throw new Error(profileError.message);

  console.log(`✔ 프로필 설정 완료 — ID: ${ADMIN.loginId} / PIN: ${ADMIN.pin} / 권한: 관리자`);
}

async function seedNotice() {
  const { data: existing, error: selectError } = await supabase
    .from("app_notices")
    .select("id")
    .eq("title", NOTICE.title)
    .maybeSingle();

  if (selectError) {
    console.warn(`⚠ 공지 조회 실패 (supabase/notices.sql 실행 여부 확인): ${selectError.message}`);
    return;
  }

  const record = { ...NOTICE, is_active: true, updated_at: new Date().toISOString() };

  const { error } = existing
    ? await supabase.from("app_notices").update(record).eq("id", existing.id)
    : await supabase.from("app_notices").insert(record);

  if (error) {
    console.warn(`⚠ 공지 저장 실패: ${error.message}`);
    return;
  }

  console.log("✔ 재가입 안내 공지를 게시했습니다. (하루 1회 노출)");
}

try {
  await seedAdmin();
  await seedNotice();
  console.log("\n완료. 로그인 화면에서 ID `admin` / PIN `255611` 로 접속해보세요.");
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
