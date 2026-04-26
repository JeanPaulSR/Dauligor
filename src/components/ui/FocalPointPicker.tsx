import React, { useRef, useCallback } from 'react';
import { cn } from '../../lib/utils';

export interface FocalPoint {
  x: number;
  y: number;
}

interface FocalPointPickerProps {
  imageUrl: string;
  value: FocalPoint;
  onChange: (point: FocalPoint) => void;
  className?: string;
}

export function FocalPointPicker({ imageUrl, value, onChange, className }: FocalPointPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const updatePoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)));
    onChange({ x, y });
  }, [onChange]);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-md cursor-crosshair select-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          updatePoint(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0) return;
          updatePoint(e.clientX, e.clientY);
        }}
      >
        <img
          src={imageUrl}
          alt=""
          className="w-full pointer-events-none"
          draggable={false}
          referrerPolicy="no-referrer"
        />
        {/* Focal point indicator */}
        <div
          className="absolute pointer-events-none"
          style={{ left: `${value.x}%`, top: `${value.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-8 h-8 rounded-full border-2 border-white shadow-lg relative">
            <div className="absolute top-1/2 left-0 right-0 h-px bg-white/80 -translate-y-1/2" />
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/80 -translate-x-1/2" />
            <div className="absolute top-1/2 left-1/2 w-2 h-2 rounded-full bg-gold -translate-x-1/2 -translate-y-1/2" />
          </div>
        </div>
      </div>
      <p className="label-text text-ink/40">
        Click or drag to set the focal point — controls how the image is framed in cards and previews.
      </p>
    </div>
  );
}
