// AURORA_FIX_VOLUME_SLIDER_V1
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface VolumeSliderProps {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Compact terminal-style volume slider with pointer, wheel, and keyboard support. */
export function VolumeSlider({ value, onChange, className }: VolumeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const safeValue = Number.isFinite(value) ? clamp(value) : 0;
  const pct = safeValue * 100;

  const setFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      const next = ratio <= 0.02 ? 0 : ratio >= 0.98 ? 1 : clamp(ratio);
      onChange(Number(next.toFixed(3)));
    },
    [onChange]
  );

  useEffect(() => {
    if (!dragging) return;

    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      setFromClientX(event.clientX);
    };

    const onUp = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      setFromClientX(event.clientX);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, setFromClientX]);

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-valuetext={`${Math.round(pct)} percent`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        draggingRef.current = true;
        setDragging(true);
        setFromClientX(event.clientX);
      }}
      onWheel={(event) => {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 0.05 : -0.05;
        onChange(Number(clamp(safeValue + delta).toFixed(3)));
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.05;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
          event.preventDefault();
          onChange(clamp(safeValue - step));
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
          event.preventDefault();
          onChange(clamp(safeValue + step));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onChange(0);
        } else if (event.key === 'End') {
          event.preventDefault();
          onChange(1);
        }
      }}
      className={cn(
        'relative h-3 w-20 shrink-0 cursor-pointer touch-none select-none border border-[var(--term-border)] bg-[var(--term-bg-input)] outline-none focus-visible:border-[var(--term-border-bright)]',
        className
      )}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-[var(--term-border-bright)]"
        style={{ width: `${pct}%` }}
      />
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[var(--term-text-bright)]"
        style={{ left: `calc(${pct}% - 1px)` }}
      />
    </div>
  );
}
