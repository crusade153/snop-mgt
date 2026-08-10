// app/inventory/page.tsx
// '재고 분석'은 '재고 현황'과 하나로 합쳐져 /stock(재고 통합 장표)이 되었다.
// 예전에 공유된 링크·즐겨찾기가 죽지 않도록 필터 쿼리를 그대로 들고 넘긴다.
import { redirect } from 'next/navigation';

export default async function InventoryRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === 'string') query.set(key, value);
    else if (Array.isArray(value) && value.length > 0) query.set(key, value[0]);
  });

  const queryString = query.toString();
  redirect(queryString ? `/stock?${queryString}` : '/stock');
}
