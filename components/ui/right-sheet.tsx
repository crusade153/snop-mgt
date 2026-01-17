'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface RightSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function RightSheet({ isOpen, onClose, title, children }: RightSheetProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isOpen) setShow(true);
    else setTimeout(() => setShow(false), 300);
  }, [isOpen]);

  if (!show && !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 배경 오버레이 */}
      <div 
        className={`fixed inset-0 bg-black/30 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
        onClick={onClose}
      />
      
      {/* 슬라이드 패널 */}
      <div 
        className={`relative w-[500px] h-full bg-white shadow-2xl transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
          {/* 헤더 */}
          <div className="flex items-center justify-between p-5 border-b border-neutral-200 bg-neutral-50">
            <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
            <button onClick={onClose} className="p-2 hover:bg-neutral-200 rounded-full transition-colors text-neutral-500">
              <X size={20} />
            </button>
          </div>

          {/* 본문 (스크롤) */}
          <div className="flex-1 overflow-y-auto p-5">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}