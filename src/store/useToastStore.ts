'use client';

// AURORA_PATCH: lightweight toast queue v1
import { create } from 'zustand';

export interface ToastMessage {
  id: string;
  message: string;
  createdAt: number;
}

interface ToastState {
  toasts: ToastMessage[];
  showToast: (message: string) => void;
  dismissToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  showToast: (message) => {
    const text =
      typeof message === 'string' ? message.trim().slice(0, 500) : '';
    if (!text) return;

    const id = `toast-${Date.now()}-${toastCounter++}`;
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-4),
        { id, message: text, createdAt: Date.now() },
      ],
    }));

    setTimeout(() => {
      useToastStore.getState().dismissToast(id);
    }, 4500);
  },

  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));
