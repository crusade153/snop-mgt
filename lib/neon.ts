import { neon } from '@neondatabase/serverless';

/**
 * Neon(Postgres) 읽기 전용 클라이언트.
 * Python 머신러닝 파이프라인이 write 한 수요예측 결과를 조회하는 용도.
 * NEON_DATABASE_URL 은 .env.local 에 별도로 설정합니다.
 */
export function getNeonSql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) {
    throw new Error('NEON_DATABASE_URL is not set in .env.local');
  }
  return neon(url);
}

export function isNeonConfigured() {
  return Boolean(process.env.NEON_DATABASE_URL);
}
