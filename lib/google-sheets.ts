import { GoogleAuth } from "google-auth-library";

const DEFAULT_SPREADSHEET_ID = "11geKhd14tUwJDBd6pf-1RcoKuMcKeEcvBFQ2VrpqI3c";
const DEFAULT_SHEET_NAME = "제품코드생성";

export type ProductCodeSheetRow = {
  productCode: string;
  productName: string;
  reviewStatus: string;
  note: string;
  sentAt: string;
  sentBy: string;
};

export type SheetWriteResult = { rowNumber: number; operation: "appended" | "updated" };

function getSheetConfig() {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("Google 서비스 계정 인증 정보가 설정되지 않았습니다.");
  return {
    spreadsheetId: process.env.GOOGLE_SHEETS_PRODUCT_CODE_SPREADSHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEETS_PRODUCT_CODE_SHEET_NAME ?? DEFAULT_SHEET_NAME,
    clientEmail,
    privateKey,
  };
}

async function getAccessToken(clientEmail: string, privateKey: string) {
  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const response = await client.getAccessToken();
  const token = typeof response === "string" ? response : response.token;
  if (!token) throw new Error("Google Sheets API 액세스 토큰을 발급하지 못했습니다.");
  return token;
}

async function sheetsRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google Sheets API 오류 (${response.status}): ${body.slice(0, 300)}`);
  }
  return response.json() as Promise<T>;
}

/** One product code maps to one row; re-sends update that row instead of appending a duplicate. */
export async function upsertProductCodeSheetRow(row: ProductCodeSheetRow): Promise<SheetWriteResult> {
  const config = getSheetConfig();
  const token = await getAccessToken(config.clientEmail, config.privateKey);
  const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values`;
  const existing = await sheetsRequest<{ values?: string[][] }>(
    `${baseUrl}/${encodeURIComponent(`${config.sheetName}!A:A`)}`,
    token,
  );
  const rowIndex = (existing.values ?? []).findIndex(
    (values, index) => index > 0 && values[0]?.trim() === row.productCode.trim(),
  );
  const values = [[row.productCode.trim(), row.productName.trim(), row.reviewStatus.trim(), row.note.trim(), row.sentAt, row.sentBy, "전송완료"]];

  if (rowIndex >= 0) {
    const rowNumber = rowIndex + 1;
    await sheetsRequest(
      `${baseUrl}/${encodeURIComponent(`${config.sheetName}!A${rowNumber}:G${rowNumber}`)}?valueInputOption=USER_ENTERED`,
      token,
      { method: "PUT", body: JSON.stringify({ values }) },
    );
    return { rowNumber, operation: "updated" };
  }

  const result = await sheetsRequest<{ updates?: { updatedRange?: string } }>(
    `${baseUrl}/${encodeURIComponent(`${config.sheetName}!A:G`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    { method: "POST", body: JSON.stringify({ values }) },
  );
  const matchedRow = result.updates?.updatedRange?.match(/![A-Z]+(\d+):/);
  return { rowNumber: matchedRow ? Number(matchedRow[1]) : 0, operation: "appended" };
}
