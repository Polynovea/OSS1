"use client";

import { useState, useEffect, useCallback } from "react";
import type { ToastMessage, ToastType } from "@/lib/admin/types";

let toastListeners: ((toast: ToastMessage) => void)[] = [];

export function showToast(message: string, type: ToastType = "info") {
  const toast: ToastMessage = {
    id: Math.random().toString(36).slice(2),
    message,
    type,
  };
  toastListeners.forEach((listener) => listener(toast));
}

export default function Toast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const listener = (toast: ToastMessage) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => removeToast(toast.id), 4000);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, [removeToast]);

  return (
    <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3 max-w-[min(400px,90vw)] w-full pointer-events-none">
      {toasts.map((toast) => {
        let typeStyles = "";
        if (toast.type === "success") {
          typeStyles = "bg-info-muted text-info border-info";
        } else if (toast.type === "error") {
          typeStyles = "bg-danger-muted text-danger border-danger";
        } else {
          typeStyles = "bg-review-muted text-review border-review";
        }

        return (
          <div
            key={toast.id}
            className={`px-5 py-3.5 rounded-lg text-sm flex items-center justify-between gap-4 border backdrop-blur-md pointer-events-auto shadow-xl animate-[slide-in_0.3s_ease-out] ${typeStyles}`}
          >
            <span className="font-body font-medium">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="bg-transparent border-none text-inherit text-xl cursor-pointer opacity-70 leading-none hover:opacity-100 transition-opacity"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
