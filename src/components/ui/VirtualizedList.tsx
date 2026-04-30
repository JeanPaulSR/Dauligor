import React, { useMemo, useState } from 'react';

type VirtualizedListProps<T> = {
  items: T[];
  height: number;
  itemHeight: number;
  overscan?: number;
  className?: string;
  innerClassName?: string;
  renderItem: (item: T, index: number) => React.ReactNode;
};

export default function VirtualizedList<T>({
  items,
  height,
  itemHeight,
  overscan = 6,
  className,
  innerClassName,
  renderItem
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = items.length * itemHeight;
  const visibleCount = Math.ceil(height / itemHeight);

  const { startIndex, endIndex, offsetY, visibleItems } = useMemo(() => {
    const rawStart = Math.floor(scrollTop / itemHeight);
    const start = Math.max(0, rawStart - overscan);
    const end = Math.min(items.length, rawStart + visibleCount + overscan);
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * itemHeight,
      visibleItems: items.slice(start, end)
    };
  }, [height, itemHeight, items, overscan, scrollTop, visibleCount]);

  return (
    <div
      className={className}
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          className={innerClassName}
          style={{
            position: 'absolute',
            top: offsetY,
            left: 0,
            right: 0
          }}
        >
          {visibleItems.map((item, index) => renderItem(item, startIndex + index))}
        </div>
      </div>
    </div>
  );
}
