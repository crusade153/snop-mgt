import { BigQuery } from '@google-cloud/bigquery';

// 환경 변수가 없는 경우 에러를 던져 실수를 방지합니다 (Fail Fast)
if (!process.env.GOOGLE_PROJECT_ID || !process.env.GOOGLE_PRIVATE_KEY) {
  throw new Error('BigQuery credentials are missing in .env.local');
}

// 싱글톤 클라이언트 생성
const bigqueryClient = new BigQuery({
  projectId: process.env.GOOGLE_PROJECT_ID,
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    // 줄바꿈 문자가 문자열로 들어올 경우를 대비해 치환
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
});

export default bigqueryClient;