// Mark & Build — the manual-upload / import window (proof of concept: spells).
//
// Pick a compendium type, set a Source (persists across creates + type switches —
// the "set it once per book" default-source behaviour the Foundry import
// workbenches use), fill the fields, watch the live preview resolve into the EXACT
// payload that will be written, then Create. The write goes through the import
// registry's `commit()`, which delegates to the editor's real write call
// (spell → `upsertSpell`) — so an entity created here is byte-identical to one
// saved from the hand editor. Span-marking of pasted source text is the next
// phase; v1 is faithful manual entry + look-before-commit.

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, FileText, Library, Sparkles, Wand2 } from 'lucide-react';
import { fetchCollection } from '../../lib/d1';
import { reportClientError, OperationType } from '../../lib/firebase';
import SingleSelectSearch from '../../components/ui/SingleSelectSearch';
import {
  listImportDescriptors,
  getImportDescriptor,
  resolveEntity,
  commitEntity,
  type ImportFieldDef,
  type ResolvedEntity,
} from '../../lib/import';

type SourceRow = { id: string; name?: string; abbreviation?: string };

export default function ImportMarkWindow({ userProfile }: { userProfile: any }) {
  const descriptors = useMemo(() => listImportDescriptors(), []);
  const [type, setType] = useState<string>(descriptors[0]?.type ?? 'spell');
  const descriptor = getImportDescriptor(type);

  const [values, setValues] = useState<Record<string, any>>({});
  // Source is held separately from the per-entity fields so it PERSISTS across
  // creates and type changes — the same "set it once per book" default-source
  // behaviour the Foundry import workbenches use.
  const [sourceId, setSourceId] = useState('');
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [saving, setSaving] = useState(false);

  // The form-state key of the descriptor's source field, if it has one.
  const sourceKey = useMemo(
    () => descriptor?.fields.find((f) => f.kind === 'source')?.key,
    [descriptor],
  );

  // Load sources once for the Source picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchCollection<SourceRow>('sources', { orderBy: 'name ASC' });
        if (!cancelled) setSources(rows);
      } catch (err) {
        console.error('[ImportMarkWindow] failed to load sources:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sourceOptions = useMemo(
    () => sources.map((s) => ({
      id: s.id,
      name: (s.abbreviation ? `${s.abbreviation} — ` : '') + (s.name || s.id),
    })),
    [sources],
  );

  // Seed the form with the descriptor's defaults whenever the type changes. The
  // source field is managed separately (sourceId), so it's skipped here and
  // persists across the type switch.
  useEffect(() => {
    if (!descriptor) return;
    const init: Record<string, any> = {};
    for (const field of descriptor.fields) {
      if (field.kind === 'source') continue;
      init[field.key] = field.default ?? (field.kind === 'boolean' ? false : '');
    }
    setValues(init);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  // Merge the persistent source into the field set the resolver / commit sees.
  const fieldsForResolve = useMemo(
    () => (sourceKey ? { ...values, [sourceKey]: sourceId } : values),
    [values, sourceKey, sourceId],
  );

  // Pure preview — the resolved payload the Create button would write.
  const resolved: ResolvedEntity | null = useMemo(() => {
    if (!descriptor) return null;
    try {
      return resolveEntity(type, fieldsForResolve);
    } catch {
      return null;
    }
  }, [type, fieldsForResolve, descriptor]);

  const setField = (key: string, value: any) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const grouped = useMemo(() => {
    const groups: { name: string; fields: ImportFieldDef[] }[] = [];
    for (const field of descriptor?.fields ?? []) {
      if (field.kind === 'source') continue; // rendered top-level, not in the grid
      const name = field.group ?? 'Fields';
      let g = groups.find((x) => x.name === name);
      if (!g) { g = { name, fields: [] }; groups.push(g); }
      g.fields.push(field);
    }
    return groups;
  }, [descriptor]);

  const handleCreate = async () => {
    if (!descriptor || !resolved) return;
    if (resolved.errors.length) {
      toast.error(resolved.errors[0]);
      return;
    }
    setSaving(true);
    try {
      // Re-resolve at commit so id + timestamps are fresh and stable for the write.
      const toWrite = resolveEntity(type, sourceKey ? { ...values, [sourceKey]: sourceId } : values);
      await commitEntity(toWrite);
      toast.success(`${descriptor.label} “${toWrite.displayName}” created`);
      // Clear name/identifier so the next entity starts fresh; Source and the
      // other fields persist so a run from one book stays quick.
      setValues((prev) => ({ ...prev, name: '', identifier: '' }));
    } catch (err) {
      console.error('[ImportMarkWindow] create failed:', err);
      toast.error(`Failed to create ${descriptor.label.toLowerCase()}.`);
      reportClientError(err, OperationType.CREATE, `import/${type}`);
    } finally {
      setSaving(false);
    }
  };

  if (!userProfile) {
    return <div className="px-6 py-12 text-center text-ink/50">Sign in to use the import window.</div>;
  }

  const sourceLabel = sourceId
    ? (sourceOptions.find((o) => o.id === sourceId)?.name ?? sourceId)
    : '— none —';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-gold/20 pb-3">
        <div className="flex items-center gap-3">
          <Wand2 className="h-5 w-5 text-gold" />
          <div>
            <h1 className="font-serif text-2xl font-bold text-ink">Mark &amp; Build</h1>
            <p className="text-xs text-ink/60">
              Set a source, fill the fields (paste from a PDF or type), preview, and create — written
              through the editor’s real save path.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-ink/60">Type</span>
          <select className="field-input h-9" value={type} onChange={(e) => setType(e.target.value)}>
            {descriptors.map((d) => (
              <option key={d.type} value={d.type}>{d.label}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Source — persistent, applies to every entity created (set once per book). */}
      {sourceKey ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-gold/20 bg-gold/[0.04] px-4 py-3">
          <div className="flex items-center gap-2">
            <Library className="h-4 w-4 text-gold" />
            <span className="text-sm font-semibold text-ink">Source</span>
          </div>
          <div className="w-64">
            <SingleSelectSearch
              value={sourceId}
              onChange={setSourceId}
              options={sourceOptions}
              placeholder="— none —"
              noEntitiesText="No sources found."
              triggerClassName="h-9 w-full text-sm"
            />
          </div>
          {!sourceId ? (
            <span className="inline-flex items-center gap-1 rounded border border-blood/30 bg-blood/10 px-2 py-0.5 text-[11px] font-semibold text-blood">
              <AlertTriangle className="h-3 w-3" /> No source — it’ll be hidden from the browser
            </span>
          ) : null}
          <span className="ml-auto text-[11px] text-ink/45">
            Applies to every entity you create — set it once per book.
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Form */}
        <div className="space-y-5">
          {grouped.map((group) => (
            <fieldset key={group.name} className="compendium-card rounded-lg border border-gold/15 p-4">
              <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.18em] text-gold/80">
                {group.name}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <FieldControl
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    onChange={(v) => setField(field.key, v)}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        {/* Preview */}
        <aside className="lg:sticky lg:top-4 h-fit space-y-3">
          <div className="compendium-card rounded-lg border border-gold/20 p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gold/80">
              <Sparkles className="h-3.5 w-3.5" /> Preview — what will be written
            </div>
            {resolved ? (
              <>
                <dl className="space-y-1 text-sm">
                  <Row label="Name" value={resolved.displayName} />
                  <Row label="Identifier" value={resolved.identifier || '—'} mono />
                  <Row label="Source" value={sourceLabel} dim={!sourceId} />
                  <Row label="New id" value={resolved.id} mono dim />
                </dl>

                {resolved.errors.length > 0 ? (
                  <ul className="mt-3 space-y-1 rounded border border-blood/30 bg-blood/5 p-2 text-xs text-blood">
                    {resolved.errors.map((e) => (<li key={e}>• {e}</li>))}
                  </ul>
                ) : null}
                {resolved.warnings.length > 0 ? (
                  <ul className="mt-2 space-y-1 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700">
                    {resolved.warnings.map((w) => (<li key={w}>⚠ {w}</li>))}
                  </ul>
                ) : null}
                {resolved.errors.length === 0 && resolved.warnings.length === 0 ? (
                  <p className="mt-3 text-xs text-emerald-700">Ready to create.</p>
                ) : null}

                <button
                  type="button"
                  className="btn-gold mt-4 w-full justify-center disabled:opacity-50"
                  disabled={saving || resolved.errors.length > 0}
                  onClick={handleCreate}
                >
                  {saving ? 'Creating…' : `Create ${descriptor?.label ?? ''}`}
                </button>
              </>
            ) : (
              <p className="text-sm text-ink/50">Fill in the fields to preview.</p>
            )}
          </div>

          {/* Raw payload — the literal object handed to the write function. */}
          {resolved ? (
            <details className="compendium-card rounded-lg border border-gold/15 p-3">
              <summary className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-ink/60">
                <FileText className="h-3.5 w-3.5" /> Resolved payload
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded bg-ink/90 p-2 text-[10px] leading-relaxed text-parchment">
{JSON.stringify(resolved.payload, null, 2)}
              </pre>
            </details>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, mono, dim }: { label: string; value: string; mono?: boolean; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] uppercase tracking-wider text-ink/50">{label}</dt>
      <dd className={`text-right ${mono ? 'font-mono text-xs' : ''} ${dim ? 'text-ink/45' : 'text-ink'} truncate`}>
        {value}
      </dd>
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: ImportFieldDef;
  value: any;
  onChange: (value: any) => void;
}) {
  const id = `imp-${field.key}`;

  // Boolean renders as a single inline checkbox row (no separate label above).
  if (field.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink/80">
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-[var(--gold)]"
        />
        {field.label}
      </label>
    );
  }

  const wrapClass = field.kind === 'textarea' ? 'sm:col-span-2' : '';

  return (
    <div className={wrapClass}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink/70">
        {field.label}
        {field.required ? <span className="ml-1 text-blood">*</span> : null}
      </label>
      {field.kind === 'textarea' ? (
        <textarea
          id={id}
          className="field-input w-full"
          rows={5}
          placeholder={field.placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.kind === 'select' ? (
        <select
          id={id}
          className="field-input h-9 w-full"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.kind === 'number' ? 'number' : 'text'}
          className="field-input h-9 w-full"
          placeholder={field.placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help ? <p className="mt-0.5 text-[10px] text-ink/45">{field.help}</p> : null}
    </div>
  );
}
