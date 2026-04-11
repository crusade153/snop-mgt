'use client';

import { Suspense, useState, useMemo } from 'react';
import Link from 'next/link';
import { Star, Search, Trash2, ExternalLink } from 'lucide-react';
import { useFavorites } from '@/hooks/use-favorites';
import { useDashboardData } from '@/hooks/use-dashboard';
import { IntegratedItem } from '@/types/analysis';

function FavoritesPageInner() {
  const { favorites, isFavorite, toggle } = useFavorites();
  const { data } = useDashboardData();
  const [searchTerm, setSearchTerm] = useState('');

  // 검색 결과 (대시보드 캐시 데이터 활용 — 별도 BigQuery 호출 없음)
  const searchResults = useMemo(() => {
    if (!searchTerm.trim() || !data?.integratedArray) return [];
    const q = searchTerm.toLowerCase();
    return (data.integratedArray as IntegratedItem[])
      .filter((item) =>
        item.name.toLowerCase().includes(q) || item.code.includes(q)
      )
      .slice(0, 20);
  }, [searchTerm, data]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
          <Star size={20} className="text-yellow-400" fill="#FBBF24" />
          관심 제품 관리
        </h1>
        <p className="text-[12px] text-neutral-700 mt-1">즐겨찾기한 제품을 관리하고, 새 제품을 추가하세요.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 현재 즐겨찾기 목록 */}
        <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-neutral-900">
              내 관심 제품
              <span className="ml-2 text-xs font-normal text-neutral-400">({favorites.length}개)</span>
            </h2>
          </div>

          {favorites.length === 0 ? (
            <div className="p-10 text-center text-neutral-400 text-sm">
              <Star size={32} className="mx-auto mb-3 text-neutral-200" />
              즐겨찾기한 제품이 없습니다.<br />
              <span className="text-xs">오른쪽 검색창에서 제품을 추가하세요.</span>
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {favorites.map((fav) => (
                <li key={fav.matnr} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-neutral-900">{fav.product_name || fav.matnr}</div>
                    <div className="text-[11px] text-neutral-400 font-mono">{fav.matnr}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/product/${fav.matnr}`}
                      className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 hover:text-primary-blue transition-colors"
                      title="제품 상세 보기"
                    >
                      <ExternalLink size={14} />
                    </Link>
                    <button
                      onClick={() => toggle(fav.matnr, fav.product_name || '')}
                      className="p-1.5 rounded hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-colors"
                      title="즐겨찾기 제거"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 제품 검색 & 추가 */}
        <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="px-5 py-4 border-b border-neutral-100">
            <h2 className="text-[15px] font-semibold text-neutral-900">제품 검색 & 추가</h2>
          </div>
          <div className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
              <input
                type="text"
                placeholder="제품명 또는 코드 검색..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue h-[38px]"
              />
            </div>

            {searchTerm.trim() === '' ? (
              <div className="p-6 text-center text-neutral-400 text-sm">
                제품명이나 코드를 입력하면<br />검색 결과가 표시됩니다.
              </div>
            ) : searchResults.length === 0 ? (
              <div className="p-6 text-center text-neutral-400 text-sm">검색 결과가 없습니다.</div>
            ) : (
              <ul className="divide-y divide-neutral-100 max-h-[400px] overflow-y-auto">
                {searchResults.map((item) => {
                  const starred = isFavorite(item.code);
                  return (
                    <li key={item.code} className="flex items-center justify-between px-2 py-2.5 hover:bg-neutral-50 transition-colors rounded">
                      <div>
                        <div className="text-sm font-medium text-neutral-900">{item.name}</div>
                        <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                      </div>
                      <button
                        onClick={() => toggle(item.code, item.name)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-colors ${
                          starred
                            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-yellow-50 hover:text-yellow-600'
                        }`}
                      >
                        <Star size={11} fill={starred ? '#FBBF24' : 'none'} className={starred ? 'text-yellow-400' : 'text-neutral-400'} />
                        {starred ? '추가됨' : '추가'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-[#E53935] rounded-full animate-spin" />
      </div>
    }>
      <FavoritesPageInner />
    </Suspense>
  );
}
