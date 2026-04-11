import { getProductDetail } from '@/actions/product-actions';
import ProductDetailClient from './product-detail-client';

interface Props {
  params: Promise<{ matnr: string }>;
}

export default async function ProductDetailPage({ params }: Props) {
  const { matnr } = await params;
  const result = await getProductDetail(matnr);

  if (!result.success || !result.data) {
    return (
      <div className="p-10 text-center text-[#E53935]">
        {result.message || '데이터를 불러올 수 없습니다.'}
      </div>
    );
  }

  return <ProductDetailClient data={result.data} />;
}
