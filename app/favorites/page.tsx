'use client';

import { Suspense, useState, useMemo } from 'react';
import Link from 'next/link';
import { Star, Search, Trash2, ExternalLink, Package, Building2 } from 'lucide-react';
import { useFavorites } from '@/hooks/use-favorites';
import { useFavoriteCustomers } from '@/hooks/use-favorite-customers';
import { useDashboardData } from '@/hooks/use-dashboard';
import { IntegratedItem, CustomerStat } from '@/types/analysis';

type TabView = 'PRODUCT' | 'CUSTOMER';

function FavoritesPageInner() {
  const { favorites, isFavorite, toggle } = useFavorites();
  const { favoriteCustomers, isFavoriteCustomer, toggleCustomer } = useFavoriteCustomers();
  const { data } = useDashboardData();
  
  const [activeTab, setActiveTab] = useState<TabView>('PRODUCT');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. 제품 검색
  const productSearchResults = useMemo(() => {
    if (activeTab !== 'PRODUCT' || !searchTerm.trim() || !data?.integratedArray) return [];
    const q = searchTerm.toLowerCase();
    return (data.integratedArray as IntegratedItem[])
      .filter(item => item.name.toLowerCase().includes(q) || item.code.includes(q))
      .slice(0, 20);
  }, [activeTab, searchTerm, data]);

  // 2. 거래처 검색
  const customerSearchResults = useMemo(() => {
    if (activeTab !== 'CUSTOMER' || !searchTerm.trim() || !data?.fulfillment?.byCustomer) return [];
    const q = searchTerm.toLowerCase();
    return (data.fulfillment.byCustomer as CustomerStat[])
      .filter(cust => cust.name.toLowerCase().includes(q) || cust.id.includes(q))
      .slice(0, 20);
  }, [activeTab, searchTerm, data]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      {/* Header */}
      <div className="pb-4 border-b border-neutral-200">
        <h1 className="text-[20px] font-bold text-neutral-900 flex items-center gap-2">
          <Star size={20} className="text-yellow-400" fill="#FBBF24" />
          관심 메뉴 관리 (제품 / 거래처)
        </h1>
        <p className="text-[12px] text-neutral-700 mt-1">즐겨찾기한 제품과 거래처를 관리하여 집중 모니터링하세요.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => { setActiveTab('PRODUCT'); setSearchTerm(''); }}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
            activeTab === 'PRODUCT' ? 'bg-[#1565C0] text-white shadow-md' : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <Package size={18} /> 관심 제품
        </button>
        <button
          onClick={() => { setActiveTab('CUSTOMER'); setSearchTerm(''); }}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all ${
            activeTab === 'CUSTOMER' ? 'bg-[#1565C0] text-white shadow-md' : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <Building2 size={18} /> 관심 거래처
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* 1. 현재 즐겨찾기 목록 */}
        <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-neutral-900">
              내 관심 {activeTab === 'PRODUCT' ? '제품' : '거래처'}
              <span className="ml-2 text-xs font-normal text-neutral-400">
                ({activeTab === 'PRODUCT' ? favorites.length : favoriteCustomers.length}개)
              </span>
            </h2>
          </div>

          <ul className="divide-y divide-neutral-100 max-h-[500px] overflow-y-auto">
            {activeTab === 'PRODUCT' ? (
              favorites.length === 0 ? (
                <div className="p-10 text-center text-neutral-400 text-sm">등록된 관심 제품이 없습니다.</div>
              ) : (
                favorites.map((fav) => (
                  <li key={fav.matnr} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 transition-colors">
                    <div>
                      <div className="text-sm font-medium text-neutral-900">{fav.product_name || fav.matnr}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{fav.matnr}</div>
                    </div>
                    <div className="flex items-center gap-2">
                       <Link href={`/product/${fav.matnr}`} className="p-1.5 rounded hover:bg-neutral-100 text-neutral-400 md:hover:text-primary-blue"><ExternalLink size={14}/></Link>
                       <button onClick={() => toggle(fav.matnr, fav.product_name || '')} className="p-1.5 hover:text-red-500 text-neutral-400"><Trash2 size={14} /></button>
                    </div>
                  </li>
                ))
              )
            ) : (
              favoriteCustomers.length === 0 ? (
                <div className="p-10 text-center text-neutral-400 text-sm">등록된 관심 거래처가 없습니다.</div>
              ) : (
                favoriteCustomers.map((fav) => (
                  <li key={fav.kunnr} className="flex items-center justify-between px-5 py-3 hover:bg-neutral-50 transition-colors">
                    <div>
                      <div className="text-sm font-medium text-neutral-900">{fav.customer_name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{fav.kunnr}</div>
                    </div>
                    <button onClick={() => toggleCustomer(fav.kunnr, fav.customer_name)} className="p-1.5 hover:text-red-500 text-neutral-400"><Trash2 size={14} /></button>
                  </li>
                ))
              )
            )}
          </ul>
        </div>

        {/* 2. 검색 및 추가 */}
        <div className="bg-white rounded shadow-[0_1px_3px_rgba(0,0,0,0.08)] border border-neutral-200">
          <div className="px-5 py-4 border-b border-neutral-100">
            <h2 className="text-[15px] font-semibold text-neutral-900">{activeTab === 'PRODUCT' ? '제품' : '거래처'} 검색 & 추가</h2>
          </div>
          <div className="p-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-2.5 text-neutral-400" size={16} />
              <input
                type="text"
                placeholder={activeTab === 'PRODUCT' ? '제품명 또는 코드 검색...' : '거래처명 또는 코드 검색...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded text-sm focus:outline-none focus:border-primary-blue h-[38px]"
              />
            </div>

            <ul className="divide-y divide-neutral-100 max-h-[400px] overflow-y-auto">
              {activeTab === 'PRODUCT' && productSearchResults.map((item) => {
                const starred = isFavorite(item.code);
                return (
                  <li key={item.code} className="flex items-center justify-between px-2 py-2.5 hover:bg-neutral-50 rounded">
                    <div>
                      <div className="text-sm font-medium text-neutral-900">{item.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{item.code}</div>
                    </div>
                    <button onClick={() => toggle(item.code, item.name)} className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold ${starred ? 'bg-yellow-100 text-yellow-700' : 'bg-neutral-100 text-neutral-600'}`}>
                      <Star size={11} fill={starred ? '#FBBF24' : 'none'} className={starred ? "text-yellow-400" : ""} /> {starred ? '추가됨' : '추가'}
                    </button>
                  </li>
                );
              })}
              {activeTab === 'CUSTOMER' && customerSearchResults.map((cust) => {
                const starred = isFavoriteCustomer(cust.id);
                return (
                  <li key={cust.id} className="flex items-center justify-between px-2 py-2.5 hover:bg-neutral-50 rounded">
                    <div>
                      <div className="text-sm font-medium text-neutral-900">{cust.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">{cust.id}</div>
                    </div>
                    <button onClick={() => toggleCustomer(cust.id, cust.name)} className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold ${starred ? 'bg-yellow-100 text-yellow-700' : 'bg-neutral-100 text-neutral-600'}`}>
                      <Star size={11} fill={starred ? '#FBBF24' : 'none'} className={starred ? "text-yellow-400" : ""} /> {starred ? '추가됨' : '추가'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-brand"></div></div>}>
      <FavoritesPageInner />
    </Suspense>
  );
}
