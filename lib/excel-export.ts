import * as XLSX from 'xlsx';
import { format } from 'date-fns';

/**
 * 공통 Excel 내보내기 유틸리티
 * @param rows - 내보낼 데이터 배열 (각 요소는 열이름:값 객체)
 * @param filename - 파일명 (확장자 제외)
 */
export function exportToExcel(rows: Record<string, any>[], filename: string) {
  if (!rows.length) {
    alert('내보낼 데이터가 없습니다.');
    return;
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const dateStr = format(new Date(), 'yyyyMMdd_HHmm');
  XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`);
}
