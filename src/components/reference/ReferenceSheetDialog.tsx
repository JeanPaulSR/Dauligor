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

            <div className="dialog-body h-[calc(100%-4.5rem)] space-y-5 overflow-y-auto">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <fieldset className="config-fieldset bg-background/20">
                  <legend className="section-label text-gold/60 px-1">How To Read This</legend>
                  <div className="space-y-2">
                    <p className="body-text text-sm text-ink/75">
                      Prefer the authoring reference in Dauligor. The Foundry column shows the
                      roll-data path or UUID-style result the module expects to target during
                      import.
                    </p>
                    <p className="field-hint">
                      Semantic references are safest when we have a Dauligor syntax for them.
                      Native Foundry paths are still shown whenever that terminology is already
                      important to creators.
                    </p>
                  </div>
                </fieldset>

                <fieldset className="config-fieldset bg-background/20">
                  <legend className="section-label text-sky-500/60 px-1">Important Rules</legend>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2">
                      <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <p className="text-sm text-ink/75">
                        Class references resolve by stable identifier, not by the display name shown
                        on the sheet. Duplicate names are safe when identifiers stay distinct.
                      </p>
                    </div>
                    <div className="flex items-start gap-2">
                      <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <p className="text-sm text-ink/75">
                        Class columns should resolve from their linked scaling or ScaleValue
                        identifier, not only from the label visible in the UI.
                      </p>
                    </div>
                  </div>
                </fieldset>
              </div>

              {sections.map((section) => (
                <fieldset key={section.id} className="config-fieldset">
                  <legend className="section-label text-gold/60 px-1">{section.title}</legend>
                  <div className="space-y-3">
                    <p className="field-hint">{section.description}</p>

                    <div className="data-table">
                      <div className="data-table-head grid grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                        <span className="data-table-th">Use Case</span>
                        <span className="data-table-th">Authoring</span>
                        <span className="data-table-th">Foundry</span>
                        <span className="data-table-th">Notes</span>
                      </div>
                      <div className="data-table-body max-h-[22rem]">
                        {section.rows.map((row) => (
                          <div
                            key={`${section.id}-${row.label}-${row.authoring}`}
                            className="data-table-row grid grid-cols-[11rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-3"
                          >
                            <span className="text-xs font-black text-ink/85">{row.label}</span>
                            <code className="text-[10px] text-gold break-all">{row.authoring}</code>
                            <code className="text-[10px] text-gold/80 break-all">{row.foundry}</code>
                            <p className="text-[10px] leading-relaxed text-ink/55">{row.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

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
                </fieldset>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
