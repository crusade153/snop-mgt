'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMlComparison, testNeonConnection } from '@/actions/ml-forecast-actions';
import CanvasCompareChart from '@/components/charts/canvas-compare-chart';
import {
  RefreshCw, Search, Filter, Database, XCircle,
  Target, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, AlertCircle,
  Info, Brain, CalendarDays, CalendarClock,
} from 'lucide-react';
import { useUiStore } from '@/store/ui-store';
import { useDateStore } from '@/store/date-store';
import { useFavorites } from '@/hooks/use-favorites';

type Metrics = {
  mape: number | null;
  bias: number | null;
  accuracy: number | null;
  nComparable: number;
  nextForecast: number | null;
  nextForecastMonth: string | null;
  periodPredicted: number;
};
type InProgress = {
  month: string;
  elapsedDays: number;
  daysInMonth: number;
  fraction: number;
  actualToDate: number | null;
  proratedPredicted: number | null;
  fullPredicted: number | null;
} | null;
type Item = {
  info: { id: string; name: string; unit: string; umrezBox: number; unitsPerEa: number };
  months: string[];
  actual: (number | null)[];
  predicted: (number | null)[];
  predictedFull: (number | null)[];
  inProgress: InProgress;
  metrics: Metrics;
};

const ITEMS_PER_PAGE = 10;

function accuracyColor(acc: number | null) {
  if (acc === null) return 'text-neutral-400';
  if (acc >= 85) return 'text-green-600';
  if (acc >= 70) return 'text-amber-600';
  return 'text-red-500';
}

// 초등학생도 이해할 수준의 도움말 툴팁 (아이콘 hover)
function InfoTip({ title, children, align = 'right' }: { title: string; children: React.ReactNode; align?: 'right' | 'left' }) {
  return (
    <span className="relative group inline-flex items-center align-middle">
      <Info size={13} className="text-neutral-400 hover:text-blue-600 cursor-help" />
      <span
        className={`pointer-events-none absolute z-40 hidden group-hover:block w-64 p-3 bg-neutral-900 text-white text-[11px] leading-relaxed rounded-lg shadow-xl top-6 ${align === 'right' ? 'right-0' : 'left-0'}`}
      >
        <span className="block font-bold text-[#42A5F5] mb-1.5">{title}</span>
        {children}
      </span>
    </span>
  );
}

export default function MlForecastPage() {
  const { unitMode, favoritesOnly } = useUiStore();
  const { startDate, endDate } = useDateStore();
  const { isFavorite } = useFavorites();

  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);

  // 연결/스키마 상태
  const [conn, setConn] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    const res = await getMlComparison(term, startDate, endDate);
    if (res.success) {
      const data = (res.data || []) as Item[];
      setItems(data);
      setDataAsOf(res.dataAsOf ?? null);
      setSelectedId(data.length > 0 ? data[0].info.id : null);
      setCurrentPage(1);
    } else {
      setItems([]);
      setSelectedId(null);
      setError(res.error || '데이터를 불러오지 못했습니다.');
    }
    setLoading(false);
  }, [startDate, endDate]);

  const checkConnection = useCallback(async () => {
    setChecking(true);
    setError(null);
    const res = await testNeonConnection();
    setConn(res);
    setChecking(false);
    if (res.error) setError(res.error);
  }, []);

  useEffect(() => { checkConnection(); }, [checkConnection]);
  useEffect(() => {
    if (conn?.connected && conn?.mapping) load('');
  }, [conn?.connected, conn?.mapping, load]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter') load(searchTerm); };

  const filteredList = useMemo(() => {
    let list = items;
    if (favoritesOnly) list = list.filter((i) => isFavorite(i.info.id));
    return list;
  }, [items, favoritesOnly, isFavorite]);

  const totalPages = Math.ceil(filteredList.length / ITEMS_PER_PAGE);
  const paginated = filteredList.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const activeItem = items.find((i) => i.info.id === selectedId) || null;

  // 단위 변환 (BOX 모드)
  const convert = (val: number | null) => {
    if (val === null) return null;
    if (unitMode === 'BOX' && activeItem) return Math.round(val / (activeItem.info.umrezBox || 1));
    return val;
  };
  const displayUnit = unitMode === 'BOX' ? 'BOX' : activeItem?.info.unit || 'EA';

  const chartActual = activeItem?.actual.map(convert) || [];
  const chartPredicted = activeItem?.predicted.map(convert) || [];
  const chartMonths = activeItem?.months || [];
  const ip = activeItem?.inProgress || null;

  // ─── 연결 안 됨: 설정 안내 카드 ──────────────────────────────────────────
  const notReady = !conn?.connected || !conn?.mapping;

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] animate-in fade-in slide-in-from-bottom-4">
      {/* 헤더 */}
      <div className="pb-4 border-b border-neutral-200 mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
            🤖 머신러닝 예측 검증
            {/* "머신러닝이란?" 도움말 */}
            <span className="relative group inline-flex items-center">
              <span className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5 cursor-help">
                <Brain size={12} /> 머신러닝이란?
              </span>
              <span className="pointer-events-none absolute z-40 hidden group-hover:block w-80 p-4 bg-neutral-900 text-white text-[11px] leading-relaxed rounded-lg shadow-xl top-8 left-0 space-y-2">
                <span className="block font-bold text-[#42A5F5] text-xs">머신러닝(기계학습)이란?</span>
                <span className="block">컴퓨터가 <b>과거 데이터를 스스로 공부</b>해서 미래를 예측하는 기술이에요. 사람이 일일이 규칙을 정해주지 않아도, 데이터 속 패턴을 찾아 다음에 얼마나 팔릴지 예상합니다.</span>
                <span className="block">이 예측은 <b>최근 2년치 월별 판매 수량</b> 패턴을 학습해 만든 값이에요.</span>
                <span className="block">매출 <b>금액이 아니라 수량</b>으로 계산한 이유 → 단가가 매달 달라 금액은 들쭉날쭉하지만, <b>수량은 실제 수요를 가장 객관적으로</b> 보여주기 때문이에요.</span>
              </span>
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {dataAsOf && !notReady && (
            <span className="hidden md:inline-flex items-center gap-1 text-xs text-neutral-500 bg-neutral-100 px-2.5 py-1.5 rounded-lg">
              <CalendarClock size={13} /> 비교 기준일 {dataAsOf} 직전까지
            </span>
          )}
          {notReady && (
            <button
              onClick={checkConnection}
              disabled={checking}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-neutral-300 text-neutral-700 rounded-lg text-sm font-bold hover:bg-neutral-50 transition-colors disabled:opacity-50"
            >
              <Database size={14} /> {checking ? '확인 중...' : '연결 확인'}
            </button>
          )}
          {!notReady && (
            <button
              onClick={() => load(searchTerm)}
              className="flex items-center gap-2 px-3 py-2 bg-neutral-900 text-white rounded-lg text-sm font-bold hover:bg-neutral-700 transition-colors"
            >
              <RefreshCw size={14} /> 데이터 갱신
            </button>
          )}
        </div>
      </div>

      {/* 연결 상태 배너 */}
      {conn && !conn.connected && (
        <div className={`mb-4 px-4 py-3 rounded-lg border text-sm flex items-start gap-2 ${conn.connected ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <XCircle size={18} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{conn.error}</span>
          </div>
        </div>
      )}

      {/* 설정/스키마 안내 (연결 준비 안 됨) */}
      {notReady ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto bg-white border border-neutral-200 rounded-xl shadow-sm p-8 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                <Database size={20} className="text-blue-600" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-neutral-900">Neon DB 연동 설정</h2>
                <p className="text-sm text-neutral-500">머신러닝 예측 결과가 저장된 Neon Postgres를 연결하세요.</p>
              </div>
            </div>

            <ol className="space-y-3 text-sm text-neutral-700">
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  프로젝트 루트 <code className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded">.env.local</code> 에 연결 문자열을 추가:
                  <pre className="mt-2 bg-neutral-900 text-neutral-100 text-xs rounded-lg p-3 overflow-x-auto">NEON_DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/dbname?sslmode=require</pre>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">2</span>
                <div>개발 서버를 재시작(<code className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded">npm run dev</code>)한 뒤 우측 상단 <b>연결 &amp; 스키마 조회</b> 버튼 클릭. (Vercel 배포 시에는 환경변수 추가 후 재배포)</div>
              </li>
              <li className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-neutral-900 text-white text-xs font-bold flex items-center justify-center">3</span>
                <div>예측 테이블은 <b>MATNR(자재코드)</b>, <b>예측 월</b>, <b>예측 수량</b> 컬럼을 포함해야 자동 감지됩니다. (Prophet의 <code>ds</code>/<code>yhat</code> 형태도 인식)</div>
              </li>
            </ol>

            {/* 연결됐지만 감지 실패 시: 테이블 목록 표시 */}
            {conn?.connected && !conn?.mapping && conn?.tables?.length > 0 && (
              <div className="pt-4 border-t border-neutral-200">
                <h3 className="font-bold text-sm text-neutral-800 mb-2">발견된 테이블 ({conn.tables.length})</h3>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {conn.tables.map((t: any) => (
                    <div key={`${t.schema}.${t.name}`} className="border border-neutral-200 rounded-lg p-3">
                      <div className="font-mono text-xs font-bold text-neutral-800">{t.schema}.{t.name}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {t.columns.map((c: any) => (
                          <span key={c.name} className="text-[10px] font-mono bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded">
                            {c.name}<span className="text-neutral-400">:{c.type}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-neutral-500 mt-3">
                  자동 감지가 되지 않으면 <code className="font-mono bg-neutral-100 px-1 rounded">actions/ml-forecast-actions.ts</code> 상단의
                  <code className="font-mono bg-neutral-100 px-1 rounded"> MANUAL_CONFIG</code> 에 테이블/컬럼명을 직접 지정하세요.
                </p>
              </div>
            )}

            {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}
          </div>
        </div>
      ) : (
        // ─── 비교 화면 ──────────────────────────────────────────────────────
        <div className="flex flex-col gap-4 flex-1 overflow-hidden">
          <div className="shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
            <div className="flex items-center gap-2 font-bold"><Brain size={16} /> ML 예측은 이렇게 비교해요</div>
            <div className="mt-1.5 text-xs leading-relaxed text-blue-800">
              과거 판매 흐름을 배운 ML이 <b>한 달 예상 수량</b>을 만들어요. 아직 지나지 않은 날은 빼고,
              <span className="mx-1 rounded bg-white/80 px-1.5 py-0.5 font-mono font-semibold">비교 예측 = 한 달 예측 × 지난 날 ÷ 한 달 날짜</span>
              로 맞춘 뒤 <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono font-semibold">정확도 = 100 − 오차율</span>로 점수를 내요.
              {ip && <span className="ml-1 font-semibold">현재 필터는 {ip.elapsedDays}/{ip.daysInMonth}만 비교합니다.</span>}
            </div>
          </div>

          <div className="flex gap-6 flex-1 overflow-hidden">
          {/* 좌측 리스트 */}
          <div className="w-[340px] flex flex-col bg-white border border-neutral-200 rounded-xl shadow-sm">
            <div className="p-4 border-b border-neutral-200 bg-neutral-50 rounded-t-xl space-y-3">
              <h2 className="font-bold text-neutral-800 text-sm flex items-center gap-2"><Filter size={14} /> 검증 대상 품목</h2>
              <div className="relative">
                <input
                  type="text"
                  placeholder="품목명/코드 검색 (Enter)"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
                />
                <Search size={14} className="absolute left-3 top-2.5 text-neutral-400" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="p-10 text-center text-sm text-neutral-400">불러오는 중...</div>
              ) : filteredList.length === 0 ? (
                <div className="p-10 text-center text-sm text-neutral-400">데이터가 없습니다.</div>
              ) : (
                paginated.map((item) => {
                  const isSel = item.info.id === selectedId;
                  const acc = item.metrics.accuracy;
                  return (
                    <button
                      key={item.info.id}
                      onClick={() => setSelectedId(item.info.id)}
                      className={`w-full text-left p-3 rounded-lg border transition-all flex items-center justify-between group ${isSel ? 'bg-[#E3F2FD] border-[#BBDEFB] shadow-sm' : 'bg-white border-transparent hover:bg-neutral-50 hover:border-neutral-200'}`}
                    >
                      <div className="flex-1 min-w-0 pr-3">
                        <div className={`font-bold text-sm leading-snug line-clamp-2 break-words ${isSel ? 'text-[#1565C0]' : 'text-neutral-700'}`}>{item.info.name}</div>
                        <div className="text-[11px] text-neutral-400 font-mono mt-1">{item.info.id}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        {acc !== null ? (
                          <>
                            <div className="text-sm font-bold text-neutral-800">{item.metrics.periodPredicted.toLocaleString()}</div>
                            <div className="text-[9px] text-neutral-400">비교 예측</div>
                            <div className={`mt-1 text-[11px] font-bold ${accuracyColor(acc)}`}>정확도 {acc}%</div>
                          </>
                        ) : (
                          <div className="text-[10px] text-neutral-400">실적없음</div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {totalPages > 1 && (
              <div className="p-3 border-t border-neutral-200 bg-neutral-50 flex justify-between items-center rounded-b-xl">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronLeft size={16} /></button>
                <span className="text-xs font-bold text-neutral-600">{currentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-neutral-200 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            )}
          </div>

          {/* 우측 상세 */}
          <div className="flex-1 flex flex-col space-y-6 overflow-y-auto pr-2">
            {activeItem ? (
              <>
                {/* 지표 카드 */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  {/* 정확도 */}
                  <div className="p-4 bg-white border border-neutral-200 rounded-xl shadow-sm">
                    <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                      <Target size={14} /> 예측 정확도
                      <span className="ml-auto">
                        <InfoTip title="정확도란?">
                          예측이 실제와 얼마나 잘 맞았는지를 <b>100점 만점</b>으로 본 점수예요. 100%에 가까울수록 잘 맞은 거예요.<br />
                          <span className="text-neutral-400">계산: 100 − 평균 오차율(MAPE). 예) 90% = 평균 10%쯤 빗나감.</span>
                        </InfoTip>
                      </span>
                    </div>
                    <div className={`text-2xl font-bold ${accuracyColor(activeItem.metrics.accuracy)}`}>
                      {activeItem.metrics.accuracy !== null ? `${activeItem.metrics.accuracy}%` : '—'}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {activeItem.metrics.mape !== null ? `평균오차 ${activeItem.metrics.mape.toFixed(1)}% · 비교 ${activeItem.metrics.nComparable}개월` : '비교 가능한 실적 없음'}
                    </div>
                  </div>

                  {/* 편향(Bias) */}
                  <div className="p-4 bg-white border border-neutral-200 rounded-xl shadow-sm">
                    <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                      {(activeItem.metrics.bias ?? 0) >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />} 예측 편향
                      <span className="ml-auto">
                        <InfoTip title="편향(치우침)이란?">
                          예측이 실제보다 계속 <b>높게(과대)</b> 나오는지 <b>낮게(과소)</b> 나오는지 방향을 알려줘요.<br />
                          <b>+</b>면 실제보다 많이 예측, <b>−</b>면 적게 예측. <b>0에 가까울수록</b> 치우침 없이 균형 잡힌 예측이에요.
                        </InfoTip>
                      </span>
                    </div>
                    <div className={`text-2xl font-bold ${activeItem.metrics.bias === null ? 'text-neutral-400' : activeItem.metrics.bias > 0 ? 'text-red-500' : 'text-blue-600'}`}>
                      {activeItem.metrics.bias !== null ? `${activeItem.metrics.bias > 0 ? '+' : ''}${activeItem.metrics.bias.toFixed(1)}%` : '—'}
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {activeItem.metrics.bias === null ? '—' : activeItem.metrics.bias > 0 ? '실제보다 과대예측 경향' : '실제보다 과소예측 경향'}
                    </div>
                  </div>

                  {/* 이번 달 월 총 예상 */}
                  <div className="p-4 bg-white border border-neutral-200 rounded-xl shadow-sm">
                    <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                      <CalendarDays size={14} /> 이번 달 총 예상 {ip ? `(${ip.month})` : ''}
                      <span className="ml-auto">
                        <InfoTip title="이번 달 총 예상이란?">
                          이번 달 <b>한 달 전체(1일~말일)</b>에 팔릴 것으로 예측한 <b>총수량</b>이에요.<br />
                          아직 달이 끝나지 않아서, 아래 비교표·그래프에서는 <b>오늘까지 지난 날짜만큼만</b>({ip ? `${ip.elapsedDays}/${ip.daysInMonth}일` : '경과분'}) 잘라서 실제와 공정하게 비교해요.
                        </InfoTip>
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-neutral-900">
                      {ip && ip.fullPredicted !== null ? convert(ip.fullPredicted)!.toLocaleString() : '—'}
                      <span className="text-sm font-normal text-neutral-400"> {displayUnit}</span>
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">
                      {ip
                        ? `${ip.elapsedDays}/${ip.daysInMonth}일 경과 · 현재 실적 ${ip.actualToDate !== null ? convert(ip.actualToDate)!.toLocaleString() : 0}${displayUnit}`
                        : '이번 달 예측 없음'}
                    </div>
                  </div>

                  {/* 다음 달 예측 */}
                  <div className="p-4 bg-white border border-neutral-200 rounded-xl shadow-sm">
                    <div className="text-xs text-neutral-500 font-bold mb-1 flex items-center gap-1">
                      <CalendarClock size={14} /> 다음 달 예측 {activeItem.metrics.nextForecastMonth ? `(${activeItem.metrics.nextForecastMonth})` : ''}
                      <span className="ml-auto">
                        <InfoTip title="다음 달 예측이란?">
                          아직 시작하지 않은 <b>다음 달에 팔릴 한 달 총수량</b> 예측이에요. 미리 <b>생산·재고 계획</b>을 세우는 데 참고해요.
                        </InfoTip>
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-neutral-900">
                      {activeItem.metrics.nextForecast !== null ? convert(activeItem.metrics.nextForecast)!.toLocaleString() : '—'}
                      <span className="text-sm font-normal text-neutral-400"> {displayUnit}</span>
                    </div>
                    <div className="text-xs text-neutral-400 mt-1">한 달 총 예상 판매수량</div>
                  </div>
                </div>

                {/* 차트 */}
                <div className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm">
                  <h3 className="font-bold text-lg mb-1 text-neutral-800 flex justify-between items-center">
                    <span className="flex items-center gap-2">📊 실제 vs ML 예측</span>
                    <span className="text-xs font-normal text-neutral-500 bg-neutral-100 px-2 py-1 rounded">단위: {displayUnit}</span>
                  </h3>
                  {ip && (
                    <p className="text-xs text-neutral-400 mb-4">
                      ※ 진행 중인 <b className="text-neutral-500">{ip.month}</b> 은 {ip.elapsedDays}/{ip.daysInMonth}일 경과분으로 예측을 안분해 비교합니다.
                    </p>
                  )}
                  <CanvasCompareChart months={chartMonths} actual={chartActual} predicted={chartPredicted} height={340} />
                </div>

                {/* 월별 상세 테이블 */}
                <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-3 border-b border-neutral-200 bg-neutral-50 font-bold text-sm text-neutral-800 flex items-center gap-2">
                    <AlertCircle size={14} /> 월별 예측 검증 상세
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-neutral-50 text-neutral-500 text-xs">
                          <th className="text-left px-6 py-2 font-semibold">월</th>
                          <th className="text-right px-4 py-2 font-semibold">실제</th>
                          <th className="text-right px-4 py-2 font-semibold">예측(비교)</th>
                          <th className="text-right px-4 py-2 font-semibold">오차</th>
                          <th className="text-right px-6 py-2 font-semibold">오차율</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeItem.months.map((m, i) => {
                          const a = convert(activeItem.actual[i]);
                          const p = convert(activeItem.predicted[i]);
                          const full = convert(activeItem.predictedFull[i]);
                          const isIp = ip?.month === m;
                          const diff = a !== null && p !== null ? p - a : null;
                          const pct = a !== null && a > 0 && p !== null ? ((p - a) / a) * 100 : null;
                          return (
                            <tr key={m} className={`border-t border-neutral-100 hover:bg-neutral-50 ${isIp ? 'bg-amber-50/40' : ''}`}>
                              <td className="px-6 py-2 font-mono text-neutral-700">
                                {m}
                                {isIp && <span className="ml-2 text-[10px] font-sans text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">진행중 {ip!.elapsedDays}/{ip!.daysInMonth}일</span>}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{a !== null ? a.toLocaleString() : <span className="text-neutral-300">—</span>}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-red-600">
                                {p !== null ? p.toLocaleString() : <span className="text-neutral-300">—</span>}
                                {isIp && full !== null && <span className="block text-[10px] text-neutral-400 font-normal">월총 {full.toLocaleString()}</span>}
                              </td>
                              <td className={`px-4 py-2 text-right tabular-nums ${diff === null ? 'text-neutral-300' : diff > 0 ? 'text-red-500' : 'text-blue-600'}`}>{diff !== null ? `${diff > 0 ? '+' : ''}${diff.toLocaleString()}` : '—'}</td>
                              <td className={`px-6 py-2 text-right tabular-nums font-medium ${pct === null ? 'text-neutral-300' : Math.abs(pct) <= 15 ? 'text-green-600' : 'text-red-500'}`}>{pct !== null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-neutral-400">좌측 목록에서 검증할 품목을 선택하세요.</div>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
