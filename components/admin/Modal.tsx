"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export default function Modal({ isOpen, onClose, title, children, maxWidth = "620px" }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass =
    maxWidth === "720px" ? "max-w-[720px]" :
    maxWidth === "640px" ? "max-w-[640px]" :
    "max-w-[620px]";

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-[6px]"
    >
      <div
        className={`w-full bg-surface-1 border border-[#2a2a2e] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-[modalSlideIn_0.3s_cubic-bezier(0.16,1,0.3,1)_forwards] ${maxWidthClass}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-subtle bg-field">
          <h3 className="m-0 font-headline font-bold text-[12px] text-action tracking-[0.1em] uppercase">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="w-[30px] h-[30px] rounded-lg bg-transparent border border-[#2a2a2e] text-fg-muted hover:border-action hover:text-action transition-colors flex items-center justify-center cursor-pointer"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[80vh] text-fg-secondary">
          {children}
        </div>
      </div>

      <style>{`
        @keyframes modalSlideIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
