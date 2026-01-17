export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-[calc(100vh-120px)] animate-in fade-in duration-300">
      {/* 하림 브랜드 컬러 스피너 */}
      <div className="relative w-12 h-12">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-neutral-200 rounded-full"></div>
        <div className="absolute top-0 left-0 w-full h-full border-4 border-transparent border-t-[#E53935] rounded-full animate-spin"></div>
      </div>
      
      <div className="mt-4 text-center">
        <h3 className="text-neutral-900 font-bold text-lg">데이터 분석 중...</h3>
        <p className="text-neutral-500 text-xs mt-1">실시간 S&OP 데이터를 불러오고 있습니다.</p>
      </div>
    </div>
  );
}