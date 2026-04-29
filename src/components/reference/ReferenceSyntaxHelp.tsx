import React from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "../ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import {
  buildReferenceExamples,
  normalizeSemanticReferenceText,
  type ReferenceExample,
  type ReferenceContext,
  type ReferenceMode,
} from "../../lib/referenceSyntax";

export default function ReferenceSyntaxHelp({
  title = "Reference Helper",
  description = "Use semantic Dauligor references when possible. This preview shows the Foundry-native shape the module will target.",
  mode = "formula",
  value = "",
  examples,
  context,
  buttonLabel = "Open Reference Help",
}: {
  title?: string;
  description?: string;
  mode?: ReferenceMode;
  value?: string;
  examples?: ReferenceExample[];
  context?: ReferenceContext;
  buttonLabel?: string;
}) {
  const rows =
    examples && examples.length > 0 ? examples : buildReferenceExamples(context);
  const normalizedValue = normalizeSemanticReferenceText(value, mode);
  const hasPreview = Boolean(value?.trim());
  const previewChanged = hasPreview && normalizedValue !== value;

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="btn-gold h-8 gap-2 border-gold/20 bg-background/50 px-3 text-[10px] uppercase tracking-widest"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {buttonLabel}
          </Button>
        }
      />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        className="w-[34rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gold/20 bg-card p-0 text-ink shadow-2xl ring-0"
      >
        <div className="border-b border-gold/10 bg-gold/5 px-4 py-3">
          <PopoverHeader className="gap-1">
            <PopoverTitle className="label-text text-gold">{title}</PopoverTitle>
            <PopoverDescription className="text-[10px] leading-relaxed text-ink/55">
              {description}
            </PopoverDescription>
          </PopoverHeader>
        </div>

        <div className="space-y-3 p-4">
          {hasPreview && (
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded-md border border-gold/10 bg-background/35 p-3">
                <p className="field-label text-ink/45">Authored Value</p>
                <code className="mt-1 block text-[10px] text-gold break-all">{value}</code>
              </div>
              <div className="rounded-md border border-gold/10 bg-background/35 p-3">
                <div className="flex items-center gap-2">
                  <p className="field-label text-ink/45">
                    {previewChanged ? "Foundry Preview" : "Preview"}
                  </p>
                  {previewChanged && <Sparkles className="w-3 h-3 text-gold/60" />}
                </div>
                <code className="mt-1 block text-[10px] text-gold break-all">{normalizedValue}</code>
              </div>
            </div>
          )}

          <div className="data-table">
            <div className="data-table-head grid grid-cols-[8rem_1fr_1fr]">
              <span className="data-table-th">Use Case</span>
              <span className="data-table-th">Authoring</span>
              <span className="data-table-th">Foundry</span>
            </div>
            <div className="data-table-body max-h-[18rem]">
              {rows.slice(0, 6).map((row) => (
                <div
                  key={`${row.label}-${row.semantic}`}
                  className="data-table-row grid grid-cols-[8rem_1fr_1fr] items-start gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-black text-ink/80">{row.label}</p>
                    <p className="mt-1 text-[10px] leading-relaxed text-ink/45">
                      {row.description}
                    </p>
                  </div>
                  <code className="text-[10px] text-gold break-all">{row.semantic}</code>
                  <code className="text-[10px] text-gold/80 break-all">{row.native}</code>
                </div>
              ))}
            </div>
          </div>

          <p className="field-hint">
            Use the full reference sheet action near Save for the broader sections like
            skills, class columns, and entity references.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
