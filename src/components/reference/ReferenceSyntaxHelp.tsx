import React from "react";
import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "../ui/button";

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
    <details className="group border border-gold/10 bg-background/30 rounded-md overflow-hidden mt-2">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none bg-background/50 hover:bg-background/80 transition-colors">
        <BookOpen className="w-3.5 h-3.5 text-gold/70" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-gold/70 group-hover:text-gold transition-colors">{buttonLabel}</span>
      </summary>
      <div className="p-3 space-y-3 border-t border-gold/10 bg-background/20">
        <div className="space-y-1">
          <p className="label-text text-gold">{title}</p>
          <p className="text-[10px] leading-relaxed text-ink/55">{description}</p>
        </div>

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
          <div className="data-table-body max-h-[18rem] overflow-y-auto custom-scrollbar pr-1">
            {rows.slice(0, examples && examples.length > 0 ? undefined : 6).map((row) => (
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
    </details>
  );
}
