'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

// AURORA_FIX_SLIDER_V1
interface SliderProps {
  value: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onDragStateChange?: (dragging: boolean) => void;
  className?: string;
  ariaLabel?: string;
}

export function Slider({
  value,
  max,
  step = 0.01,
  onChange,
  onDragStateChange,
  className,
  ariaLabel,
}: SliderProps) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const draggingRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);
  const [dragValue, setDragValue] = React.useState<number | null>(null);

  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const externalValue =
    Number.isFinite(value) && value > 0
      ? Math.min(value, safeMax)
      : 0;
  const activeValue =
    dragging && dragValue !== null
      ? Math.max(0, Math.min(dragValue, safeMax))
      : externalValue;
  const pct = Math.min(100, Math.max(0, (activeValue / safeMax) * 100));

  const computeFromClientX = React.useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (ratio <= 0.015) return 0;
      if (ratio >= 0.995) return safeMax;
      const raw = ratio * safeMax;
      if (step > 0) {
        const snapped = Math.round(raw / step) * step;
        return Math.max(0, Math.min(safeMax, Number(snapped.toFixed(4))));
      }
      return raw;
    },
    [safeMax, step]
  );

  React.useEffect(() => {
    if (!dragging) return;

    const handleMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const next = computeFromClientX(event.clientX);
      setDragValue(next);
      onChange(next);
    };

    const finishDrag = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      const next = computeFromClientX(event.clientX);
      draggingRef.current = false;
      setDragging(false);
      setDragValue(null);
      onChange(next);
      onDragStateChange?.(false);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  }, [dragging, computeFromClientX, onChange, onDragStateChange]);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Number(activeValue.toFixed(2))}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const next = computeFromClientX(event.clientX);
        draggingRef.current = true;
        setDragging(true);
        setDragValue(next);
        onDragStateChange?.(true);
        onChange(next);
      }}
      onKeyDown={(event) => {
        const jump = Math.max(step || 1, safeMax * 0.02);
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          onChange(Math.max(0, activeValue - jump));
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onChange(Math.min(safeMax, activeValue + jump));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(safeMax);
        }
      }}
      className={cn(
        'relative flex items-center h-4 w-full bg-[var(--term-bg-input)] border border-[var(--term-border)] group cursor-pointer touch-none select-none outline-none focus-visible:border-[var(--term-border-bright)]',
        className
      )}
    >
      <div
        className="h-full bg-[var(--term-border-bright)] pointer-events-none transition-none opacity-80 group-hover:opacity-100"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-2 bg-[var(--term-text-bright)] border border-[var(--term-bg)] pointer-events-none"
        style={{ left: `clamp(0px, calc(${pct}% - 4px), calc(100% - 8px))` }}
      />
    </div>
  );
}
