import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Crosshair, GripVertical, ScrollText, X } from "lucide-react";
import { Button } from "../ui/button";
import {
  buildReferenceSheetSections,
  type ReferenceContext,
} from "../../lib/referenceSyntax";

export default function ReferenceSheetDialog({
  title = "Reference Sheet",
  triggerLabel = "Open Reference Sheet",
  triggerClassName = "",
  triggerIcon = "book",
  context,
}: {
  title?: string;
  triggerLabel?: string;
  triggerClassName?: string;
  triggerIcon?: "book" | "scroll";
  context?: ReferenceContext;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const sections = buildReferenceSheetSections(context);
  const TriggerIcon = triggerIcon === "scroll" ? ScrollText : BookOpen;
  const windowSize = useMemo(() => ({ width: 1040, height: 720 }), []);

  useEffect(() => {
    if (!open || position) return;
    const width = Math.min(windowSize.width, window.innerWidth - 48);
    const x = Math.max(24, window.innerWidth - width - 48);
    const y = Math.max(24, Math.round(window.innerHeight * 0.08));
    setPosition({ x, y });
  }, [open, position, windowSize]);

  useEffect(() => {
    if (!open) return;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const width = Math.min(windowSize.width, window.innerWidth - 48);
      const maxX = Math.max(24, window.innerWidth - width - 24);
      const maxY = Math.max(24, window.innerHeight - 220);

      const nextX = Math.min(maxX, Math.max(24, event.clientX - dragState.offsetX));
      const nextY = Math.min(maxY, Math.max(24, event.clientY - dragState.offsetY));
      setPosition({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      dragStateRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [open, windowSize]);

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!position) return;
    dragStateRef.current = {
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    };
  };

  const width = typeof window !== "undefined"
    ? Math.min(windowSize.width, window.innerWidth - 48)
    : windowSize.width;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          if (!position && typeof window !== "undefined") {
            const initialWidth = Math.min(windowSize.width, window.innerWidth - 48);
            setPosition({
              x: Math.max(24, window.innerWidth - initialWidth - 48),
              y: Math.max(24, Math.round(window.innerHeight * 0.08)),
            });
          }
        }}
        className={`btn-gold h-8 gap-2 ${triggerClassName}`.trim()}
      >
        <TriggerIcon className="w-3.5 h-3.5" />
        {triggerLabel}
      </Button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[160] rounded-xl border border-gold/20 bg-card shadow-2xl"
            style={{
              left: position?.x ?? 24,
              top: position?.y ?? 24,
              width,
              maxWidth: "calc(100vw - 3rem)",
              height: "min(78vh, 720px)",
            }}
          >
            <div
              className="dialog-header flex cursor-move items-center justify-between gap-3"
              onMouseDown={handleHeaderMouseDown}
            >
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical className="h-4 w-4 shrink-0 text-gold/50" />
                <div className="min-w-0">
                  <h2 className="dialog-title truncate">{title}</h2>
                  <p className="field-hint mt-1 max-w-3xl text-gold/55">
                    Drag this window anywhere while you edit class features, spellcasting,
                    or advancements.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                className="h-8 w-8 p-0 text-gold/70 hover:bg-gold/10 hover:text-gold"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="dialog-body h-[calc(100%-4.5rem)] space-y-5 overflow-y-auto custom-scrollbar">
              <div className="rounded-md border border-gold/20 bg-gold/5 p-4">
                <p className="text-sm font-bold text-gold">
                  This reference sheet is meant to be used for Foundry correct formulas. Use the Dauligor formula, as the Import Module will handle the conversion.
                </p>
              </div>

              {sections.map((section) => {
                const renderTable = (rows: typeof section.rows) => (
                  <div className="data-table flex-1">
                    <div className="data-table-head grid grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)]">
                      <span className="data-table-th">Name</span>
                      <span className="data-table-th">Dauligor</span>
                      <span className="data-table-th">Foundry</span>
                    </div>
                    <div className="data-table-body">
                      {rows.map((row) => (
                        <div
                          key={`${section.id}-${row.label}-${row.authoring}`}
                          className="data-table-row grid grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 py-1.5"
                        >
                          <span className="text-xs font-black text-ink/85">{row.label}</span>
                          <code className="text-[10px] text-gold break-all">{row.authoring}</code>
                          <code className="text-[10px] text-gold/80 break-all">{row.foundry}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                );

                const content = (
                  <div className="space-y-4 mt-4">
                    {section.description && <p className="field-hint">{section.description}</p>}
                    
                    {section.isSplit ? (
                      <div className="flex gap-4 items-start">
                        {renderTable(section.rows.slice(0, Math.ceil(section.rows.length / 2)))}
                        {renderTable(section.rows.slice(Math.ceil(section.rows.length / 2)))}
                      </div>
                    ) : (
                      renderTable(section.rows)
                    )}

                    {section.notes && section.notes.length > 0 && (
                      <div className="rounded-md border border-gold/10 bg-background/30 p-3">
                        {section.notes.map((note) => (
                          <p key={note} className="field-hint">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );

                if (section.isDropdown) {
                  return (
                    <details key={section.id} className="config-fieldset group">
                      <summary className="text-sm font-black uppercase tracking-widest text-gold px-1 cursor-pointer hover:text-gold/80 outline-none list-item">
                        {section.title}
                      </summary>
                      {content}
                    </details>
                  );
                }

                return (
                  <fieldset key={section.id} className="config-fieldset pt-3">
                    <legend className="text-sm font-black uppercase tracking-widest text-gold px-1">{section.title}</legend>
                    {content}
                  </fieldset>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
