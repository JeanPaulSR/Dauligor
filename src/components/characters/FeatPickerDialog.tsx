import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Check, Search, X, BookOpen, Wand2 } from 'lucide-react';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import BBCodeRenderer from '../BBCodeRenderer';
import FeatImportWorkbench from '../compendium/FeatImportWorkbench';

/**
 * FeatPickerDialog
 * ────────────────
 * Modal feat-picker shared by the ASI feat-choice card (and any future
 * "take N feats" advancement runtime). Renders a scrollable feat list
 * with name + subtype + description preview; click to toggle, click
 * Confirm to commit.
 *
 * Admins / content-creators get an "Import from Foundry…" toolbar
 * button that opens `FeatImportWorkbench` inside a nested dialog. When
 * the nested dialog closes, `onCatalogRefresh` is fired so the picker
 * pool reflects any newly imported feats without a page reload.
 *
 * Selection model:
 *   - Stateless w.r.t. ownership — the caller passes `alreadyOwnedIds`
 *     so the picker can disable rows the character already has.
 *   - Local draft state holds the current selection until Confirm is
 *     clicked; cancelling discards. This matches the SpellChoiceDialog
 *     pattern but uses a stage/commit gate instead of a live-write
 *     idiom because the picker is opened from a card-level button.
 *   - `count` caps how many feats can be selected at once. Default 1
 *     for ASI usage; can be raised for "pick N feats" flows.
 */

export type FeatPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Feats catalog already filtered by caller (e.g. feat_type='feat').
  // The picker does not refilter — that's the caller's responsibility
  // so race / background / monster pickers can reuse this same shell.
  pool: any[];
  // Max feats the user may pick before confirming. 1 for ASI.
  count: number;
  // Feat ids the character already owns — disabled in the picker so a
  // player can't accidentally double-take. Optional; defaults to none.
  alreadyOwnedIds?: string[];
  // Fired with the selected feat ROWS (not just ids) when Confirm is
  // pressed. Caller is responsible for writing into selectedOptionsMap
  // + stamping the row into optionsCache with `__sourceTable: 'feats'`
  // so the owned-feat synthesis walker can pick it up.
  onSelect: (feats: any[]) => void;
  // Used for admin gating on the "Import from Foundry…" button. The
  // workbench itself also gates on `role === 'admin'`, but checking
  // here lets us hide the button entirely for non-admins.
  userProfile: any;
  // Called after a Foundry import finishes. Caller refreshes the
  // catalog (e.g. re-runs `fetchCollection('feats')`) and returns the
  // new pool. The picker updates its local pool from this return value
  // so the newly-imported feat appears immediately.
  onCatalogRefresh?: () => Promise<any[]>;
  title?: string;
  subtitle?: string;
};

export default function FeatPickerDialog({
  open,
  onOpenChange,
  pool,
  count,
  alreadyOwnedIds = [],
  onSelect,
  userProfile,
  onCatalogRefresh,
  title = 'Pick a Feat',
  subtitle,
}: FeatPickerDialogProps) {
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator =
    !!userProfile?.permissions &&
    Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  // Selection state — id list. Reset whenever the dialog opens so the
  // picker starts clean rather than remembering an aborted prior pick.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  // Local pool override — populated when `onCatalogRefresh` returns a
  // fresh list after a Foundry import. `null` means "use caller pool".
  const [livePool, setLivePool] = useState<any[] | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setSearch('');
      setLivePool(null);
      setImportOpen(false);
    }
  }, [open]);

  const ownedSet = useMemo(
    () => new Set((alreadyOwnedIds || []).map((id) => String(id))),
    [alreadyOwnedIds],
  );

  const effectivePool = livePool ?? pool;

  const visiblePool = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return effectivePool;
    return effectivePool.filter((feat: any) => {
      const name = String(feat?.name || '').toLowerCase();
      const subtype = String(feat?.featSubtype || feat?.feat_subtype || '').toLowerCase();
      const desc = String(feat?.description || '').toLowerCase();
      return name.includes(q) || subtype.includes(q) || desc.includes(q);
    });
  }, [effectivePool, search]);

  const handleConfirm = () => {
    if (selectedIds.length === 0) return;
    const selectedFeats = selectedIds
      .map((id) => effectivePool.find((feat: any) => String(feat?.id) === String(id)))
      .filter(Boolean);
    onSelect(selectedFeats);
    onOpenChange(false);
  };

  const toggleFeat = (featId: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(featId)) {
        return prev.filter((id) => id !== featId);
      }
      if (prev.length >= count) {
        // Single-select shortcut for the common ASI case (count === 1):
        // replace rather than reject so the user can browse without
        // having to deselect first.
        if (count === 1) return [featId];
        return prev;
      }
      return [...prev, featId];
    });
  };

  const handleRefreshAfterImport = async () => {
    setImportOpen(false);
    if (!onCatalogRefresh) return;
    try {
      const fresh = await onCatalogRefresh();
      setLivePool(Array.isArray(fresh) ? fresh : null);
    } catch (err) {
      console.error('Feat catalog refresh failed', err);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Outer picker dialog. Mirrors the SpellChoiceDialog z-index +
          backdrop tokens so it composes correctly with the rest of
          CharacterBuilder's overlay stack. */}
      <div className="fixed inset-0 bg-ink/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <Card className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-indigo-500 bg-background shadow-2xl overflow-hidden">
          <CardHeader className="border-b border-indigo-500/20 flex flex-row items-center justify-between shrink-0 gap-3">
            <div className="min-w-0">
              <CardTitle className="font-serif text-2xl font-black text-ink flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                {title}
              </CardTitle>
              <CardDescription className="text-ink/60 font-bold uppercase text-[10px] tracking-widest mt-1">
                {subtitle
                  ? subtitle
                  : `Choose ${count} from ${visiblePool.length}${selectedIds.length > 0 ? ` · ${selectedIds.length} chosen` : ''}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImportOpen(true)}
                  className="h-8 border-indigo-500/40 text-indigo-700 hover:bg-indigo-500/10 hover:border-indigo-500 font-bold tracking-widest uppercase text-[10px]"
                  title="Import a feat from a Foundry export"
                >
                  <BookOpen className="w-3 h-3 mr-2" />
                  Import from Foundry…
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>

          <div className="border-b border-indigo-500/10 px-4 py-2 flex items-center gap-2 shrink-0 bg-card/60">
            <Search className="w-4 h-4 text-ink/40 shrink-0" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search feats by name, subtype, or description…"
              className="bg-transparent border-0 h-8 text-xs focus-visible:ring-0"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-ink/40 hover:text-ink/70 text-xs leading-none"
              >
                Clear
              </button>
            )}
          </div>

          <CardContent className="flex-1 overflow-y-auto p-0">
            {visiblePool.length === 0 ? (
              <div className="p-8 text-center text-ink/50 font-serif italic">
                {search
                  ? 'No feats match the current search.'
                  : 'No feats in the picker pool.'}
              </div>
            ) : (
              <div className="divide-y divide-indigo-500/10">
                {visiblePool.map((feat: any) => {
                  const featId = String(feat?.id || '');
                  const isOwned = ownedSet.has(featId);
                  const isSelected = selectedIds.includes(featId);
                  const atCap =
                    !isSelected && selectedIds.length >= count && count > 1;
                  const disabled = isOwned || atCap;
                  const subtype = feat?.featSubtype || feat?.feat_subtype || '';
                  const description = feat?.description || '';

                  return (
                    <button
                      key={featId}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        toggleFeat(featId);
                      }}
                      className={`w-full text-left p-4 flex gap-4 transition-colors ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-indigo-500/5'
                      } ${isSelected ? 'bg-indigo-500/10' : ''}`}
                    >
                      <div className="pt-1">
                        <div
                          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-indigo-500/40'
                          }`}
                        >
                          {isSelected && <Check className="w-4 h-4" />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-serif font-bold text-ink text-base flex items-center gap-2 flex-wrap">
                          <span>{feat?.name || featId}</span>
                          {subtype && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">
                              {subtype}
                            </span>
                          )}
                          {isOwned && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blood/60 italic">
                              Already taken
                            </span>
                          )}
                        </div>
                        {description && (
                          <div className="text-xs font-serif text-ink/70 mt-1 leading-relaxed line-clamp-3">
                            <BBCodeRenderer content={description} />
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>

          <div className="border-t border-indigo-500/20 p-3 flex items-center justify-between gap-3 shrink-0 bg-card/70">
            <span className="text-[10px] uppercase font-bold tracking-widest text-ink/50">
              {selectedIds.length} / {count} selected
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-ink/60"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirm}
                disabled={selectedIds.length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold tracking-widest uppercase text-[10px]"
              >
                <Plus className="w-3 h-3 mr-2" />
                Confirm
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Nested dialog — Foundry import workbench. Renders only when
          the admin opens it from the header button. We mount the
          workbench inside its own full-overlay container (z-60 so it
          stacks above the picker) rather than reusing the picker's
          card body. Closing it (via the bottom Close button) fires
          `onCatalogRefresh` so the picker refetches the catalog and
          the just-imported feat shows up live. */}
      {importOpen && canManage && (
        <div className="fixed inset-0 bg-ink/85 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="max-w-7xl w-full h-[92vh] bg-background border-4 border-indigo-500 rounded-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="border-b border-indigo-500/20 px-5 py-3 flex items-center justify-between shrink-0 bg-card/60">
              <div className="flex items-center gap-2 text-indigo-700">
                <BookOpen className="w-4 h-4" />
                <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-ink">
                  Import Feat From Foundry
                </h3>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefreshAfterImport()}
                className="h-8 border-indigo-500/40 text-indigo-700 hover:bg-indigo-500/10 text-[10px] uppercase tracking-widest font-bold"
              >
                <X className="w-3 h-3 mr-2" />
                Close &amp; Refresh
              </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <FeatImportWorkbench
                userProfile={userProfile}
                onImportComplete={async () => {
                  // Live-refresh on every successful upsert so the
                  // imported feat appears in the picker even before
                  // the admin closes the nested dialog.
                  if (!onCatalogRefresh) return;
                  try {
                    const fresh = await onCatalogRefresh();
                    setLivePool(Array.isArray(fresh) ? fresh : null);
                  } catch (err) {
                    console.error('Feat catalog refresh failed', err);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
