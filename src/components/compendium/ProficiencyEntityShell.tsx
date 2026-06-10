import React, {
  useState,
  useEffect,
  useMemo,
  Dispatch,
  SetStateAction,
  ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronLeft,
  Trash2,
  Plus,
  X,
} from 'lucide-react';

import { fetchCollection, upsertDocument, deleteDocument } from '../../lib/d1';
import { slugify } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConfirmDialog } from '../ui/confirm-dialog';
import MarkdownEditor from '../MarkdownEditor';
import EntityListSection, { type ColumnDef } from './EntityListSection';
import EntityEditModal, {
  FormSectionHeading,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './EntityEditModal';

// ─────────────────────────────────────────────────────────────────────────────
// Standard form shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields every proficiency editor carries. Field names use camelCase
 * aliases; the shell converts to snake_case at save time.
 *
 * Entity-specific extras are merged in via the `TExtra` generic and
 * surfaced through `renderExtraFields` / `buildExtraPayload` /
 * `hydrateExtras`.
 */
export type StandardProficiencyForm = {
  name: string;
  identifier: string;
  foundryAlias: string;
  /** The chosen ability's identifier (e.g., 'STR'). Resolved to `ability_id` at save. */
  abilityIdentifier: string;
  /** When `categoryFK` is configured, this holds the selected FK id. */
  categoryId: string;
  /**
   * When `categoryFreeText` is configured (taxonomy mode), this holds
   * the typed value. Stored as plain text on the row, not an FK id.
   */
  categoryText: string;
  description: string;
  source: string;
  page: number | '';
  basicRules: boolean;
  /** Display-priority integer; only used when `includeOrder` is true. */
  order: number | '';
};

const BLANK_STANDARD: StandardProficiencyForm = {
  name: '',
  identifier: '',
  foundryAlias: '',
  abilityIdentifier: '',
  categoryId: '',
  categoryText: '',
  description: '',
  source: 'PHB',
  page: '',
  basicRules: false,
  order: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryFKConfig {
  /** D1 column name on the entity row, e.g., 'category_id'. */
  column: string;
  /** D1 table to load the selectable options from, e.g., 'toolCategories'. */
  referenceTable: string;
  /** Label shown above the select. */
  label: string;
  /** If true, the form rejects save when the field is empty. */
  required?: boolean;
}

/**
 * Alternative to `CategoryFKConfig` for entities that store category
 * as free text (with autocomplete suggestions) rather than as a FK id.
 * Used by taxonomy editors like Languages where the category is a
 * loose grouping string ("Common", "Exotic", etc.) populated from
 * (but not joined to) another table.
 */
export interface CategoryFreeTextConfig {
  /** D1 column name on the entity row, e.g., 'category'. */
  column: string;
  /**
   * Optional D1 table whose row names populate the `<datalist>` for
   * autocomplete suggestions. Stored as text; no FK relationship.
   */
  suggestionsCollection?: string;
  /** Label shown above the input. */
  label: string;
  /** If true, the form rejects save when the field is empty. */
  required?: boolean;
}

export interface ExtraLookupConfig {
  /** Bucket name inside the `lookups` map surfaced to caller callbacks. */
  key: string;
  collection: string;
  orderBy?: string;
}

export interface ProficiencyEntityShellProps<
  TExtra extends Record<string, any> = Record<string, any>
> {
  /** D1 table holding the entity rows (e.g., 'skills', 'tools'). */
  table: string;
  /** Display label for one row, e.g., 'Skill'. */
  singular: string;
  /** Display label for the collection, e.g., 'Skills'. */
  plural: string;
  /** Lucide icon for the page header + modal hero. */
  icon: LucideIcon;
  /** Italic subtitle under the page title. */
  description: string;
  /** When true, the shell omits its title block (used by AdminProficiencies tabs). */
  hideHeader?: boolean;
  /** Optional back-link rendered above the title when `hideHeader` is false. */
  backLink?: { href: string; label: string };

  /** Optional FK column the editor needs (categories for Tools/Armor/Weapons). */
  categoryFK?: CategoryFKConfig;
  /**
   * Alternative to `categoryFK` — taxonomy editors that store the
   * category as plain text with autocomplete (Languages, etc.) use
   * this. Mutually exclusive with `categoryFK`.
   */
  categoryFreeText?: CategoryFreeTextConfig;
  /** Whether to render the Ability Score select. Default true. */
  includeAbility?: boolean;
  /**
   * Whether to render the Foundry Alias field. Default true.
   * Taxonomy editors that don't carry a Foundry alias set this to
   * false to suppress the field entirely.
   */
  includeFoundryAlias?: boolean;
  /**
   * Whether to render the Source + Page fields. Default true.
   * Simpler taxonomies (categories, attributes) don't track source.
   */
  includeSource?: boolean;
  /**
   * Whether to render the Basic Rules toggle. Default true. Off for
   * editors whose entities aren't part of any export gating.
   */
  includeBasicRules?: boolean;
  /**
   * Whether to render an Order (display priority) integer field +
   * table column. Default false. Used by the simple-taxonomy editors
   * that need explicit ordering.
   */
  includeOrder?: boolean;
  /**
   * Column-naming convention of the backing table. Default 'snake'
   * (legacy taxonomies persist `order` + `updated_at`). Set 'camel'
   * for new camelCase tables (persist `sort` + `updatedAt`) — Foundry
   * is camelCase end-to-end and we are migrating taxonomies off
   * snake_case. Only the persisted column names change; the form state
   * still uses `order` internally.
   */
  columnCase?: 'snake' | 'camel';
  /**
   * Optional transform applied to the auto-generated identifier slug
   * before save. Default is identity. The Attributes tab uses
   * `s => s.toUpperCase()` to keep STR/DEX/CON/etc. uppercase even
   * when the user types a lowercase name.
   */
  identifierTransform?: (slug: string) => string;
  /** Additional D1 collections to load and surface via `lookups`. */
  extraLookups?: ExtraLookupConfig[];
  /** Initial values for the entity-specific extras (merged with `BLANK_STANDARD`). */
  extraDefaults?: TExtra;

  /** Render the extras section of the form (between Metadata and the footer in the modal). */
  renderExtraFields?: (args: {
    formData: StandardProficiencyForm & TExtra;
    setFormData: Dispatch<SetStateAction<StandardProficiencyForm & TExtra>>;
    lookups: Record<string, any[]>;
  }) => ReactNode;

  /** Render small badges inside the modal hero (e.g., weapon type chip, properties). */
  renderExtraBadges?: (args: {
    entry: any;
    lookups: Record<string, any[]>;
  }) => ReactNode;

  /** Build the entity-specific snake_case fields appended to the save payload. */
  buildExtraPayload?: (formData: StandardProficiencyForm & TExtra) => Record<string, any>;

  /** Map an existing row's extras into the form-state shape on Edit. */
  hydrateExtras?: (entry: any) => Partial<TExtra>;

  /** Optional user role gate override. Default: admin-only. */
  isAuthorized?: (userProfile: any) => boolean;
}

interface InnerProps<T extends Record<string, any>>
  extends ProficiencyEntityShellProps<T> {
  userProfile: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'identifier' | 'ability' | 'order';
type SortDir = 'asc' | 'desc';

export default function ProficiencyEntityShell<
  TExtra extends Record<string, any> = Record<string, any>
>(props: InnerProps<TExtra>) {
  const {
    userProfile,
    table,
    singular,
    plural,
    icon: Icon,
    description,
    hideHeader,
    backLink,
    categoryFK,
    categoryFreeText,
    includeAbility = true,
    includeFoundryAlias = true,
    includeSource = true,
    includeBasicRules = true,
    includeOrder = false,
    columnCase = 'snake',
    identifierTransform,
    extraLookups = [],
    extraDefaults,
    renderExtraFields,
    renderExtraBadges,
    buildExtraPayload,
    hydrateExtras,
    isAuthorized,
  } = props;

  // DB column names differ between the legacy snake_case taxonomies and the
  // new camelCase tables. Form state always uses `order` internally; only the
  // persisted column name varies (order→sort, updated_at→updatedAt for camel).
  const orderColumn = columnCase === 'camel' ? 'sort' : 'order';
  const updatedColumn = columnCase === 'camel' ? 'updatedAt' : 'updated_at';

  const authorized = isAuthorized
    ? isAuthorized(userProfile)
    : userProfile?.role === 'admin';

  const [entries, setEntries] = useState<any[]>([]);
  const [attributes, setAttributes] = useState<any[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<any[]>([]);
  /** When `categoryFreeText.suggestionsCollection` is set, holds the
   *  rows whose `name` values populate the autocomplete datalist. */
  const [categorySuggestions, setCategorySuggestions] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [lookups, setLookups] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  const buildBlank = (): StandardProficiencyForm & TExtra => ({
    ...BLANK_STANDARD,
    ...(extraDefaults || ({} as TExtra)),
  });

  // ── Modal + form state ───────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] =
    useState<StandardProficiencyForm & TExtra>(buildBlank());
  const [saving, setSaving] = useState(false);
  // Row id pending a destructive confirmation. The ConfirmDialog opens
  // when this is non-null, so the same flow covers both the list-row
  // delete and the modal's Delete button.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ── List view state ──────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // ── Load everything in parallel ──────────────────────────────────────────
  useEffect(() => {
    if (!authorized) return;
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const tasks: Promise<any[]>[] = [
          fetchCollection(table, { orderBy: 'name ASC' }),
        ];
        if (includeAbility) {
          tasks.push(fetchCollection('attributes', { orderBy: '"order" ASC' }));
        } else {
          tasks.push(Promise.resolve([]));
        }
        if (categoryFK) {
          tasks.push(
            fetchCollection(categoryFK.referenceTable, {
              orderBy: '"order" ASC, name ASC',
            }),
          );
        } else {
          tasks.push(Promise.resolve([]));
        }
        // Sources table — drives the modal's Source dropdown. Always
        // fetched so the dropdown can list every available source
        // regardless of which editor is showing.
        tasks.push(fetchCollection('sources', { orderBy: 'name ASC' }));
        // Free-text category suggestions (taxonomy mode). Empty array
        // when this mode isn't in use.
        if (categoryFreeText?.suggestionsCollection) {
          tasks.push(
            fetchCollection(categoryFreeText.suggestionsCollection, {
              orderBy: 'name ASC',
            }),
          );
        } else {
          tasks.push(Promise.resolve([]));
        }
        for (const cfg of extraLookups) {
          tasks.push(
            fetchCollection(cfg.collection, {
              orderBy: cfg.orderBy || 'name ASC',
            }),
          );
        }

        const results = await Promise.all(tasks);
        if (!active) return;

        setEntries(results[0] || []);
        setAttributes(results[1] || []);
        setCategoryOptions(results[2] || []);
        setSources(results[3] || []);
        setCategorySuggestions(results[4] || []);

        const lookupMap: Record<string, any[]> = {};
        extraLookups.forEach((cfg, idx) => {
          lookupMap[cfg.key] = results[5 + idx] || [];
        });
        setLookups(lookupMap);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[ProficiencyEntityShell:${table}] load failed:`, err);
        toast.error(`Failed to load ${plural.toLowerCase()}`);
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, table]);

  // ── Default form selections once dropdowns have data ─────────────────────
  // Only seeds when the modal is open in CREATE mode (no editingId). For
  // EDIT mode the form is hydrated from the row in `openEdit`.
  useEffect(() => {
    if (!modalOpen || editingId) return;
    setFormData((prev) => {
      const next = { ...prev };
      let changed = false;

      if (
        includeAbility &&
        !prev.abilityIdentifier &&
        attributes.length > 0
      ) {
        next.abilityIdentifier = attributes[0].identifier;
        changed = true;
      }
      if (categoryFK && !prev.categoryId && categoryOptions.length > 0) {
        next.categoryId = categoryOptions[0].id;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [
    modalOpen,
    editingId,
    includeAbility,
    attributes,
    categoryFK,
    categoryOptions,
  ]);

  // ── Modal handlers ───────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null);
    setFormData(buildBlank());
    setModalOpen(true);
  };

  const openEdit = (entry: any) => {
    setEditingId(entry.id);
    const abilityIdentifier =
      attributes.find((a) => a.id === entry.ability_id)?.identifier ||
      attributes[0]?.identifier ||
      '';
    const next: StandardProficiencyForm & TExtra = {
      ...buildBlank(),
      name: entry.name || '',
      identifier: entry.identifier || '',
      foundryAlias: entry.foundry_alias || '',
      abilityIdentifier,
      categoryId: categoryFK ? entry[categoryFK.column] || '' : '',
      categoryText: categoryFreeText ? entry[categoryFreeText.column] || '' : '',
      description: entry.description || '',
      source: entry.source || '',
      page: entry.page ?? '',
      basicRules: !!entry.basic_rules,
      order: entry[orderColumn] ?? '',
      ...(hydrateExtras ? hydrateExtras(entry) : ({} as Partial<TExtra>)),
    } as StandardProficiencyForm & TExtra;
    setFormData(next);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    // Don't reset form immediately — let the close animation run with the
    // values in place. Next openCreate / openEdit will replace formData.
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (categoryFK?.required && !formData.categoryId) {
      toast.error(`${categoryFK.label} is required`);
      return;
    }
    if (categoryFreeText?.required && !formData.categoryText.trim()) {
      toast.error(`${categoryFreeText.label} is required`);
      return;
    }

    const abilityId = includeAbility
      ? attributes.find((a) => a.identifier === formData.abilityIdentifier)?.id ||
        null
      : undefined;

    const baseSlug = formData.identifier.trim() || slugify(formData.name);
    const finalIdentifier = identifierTransform
      ? identifierTransform(baseSlug)
      : baseSlug;

    const payload: Record<string, any> = {
      name: formData.name.trim(),
      identifier: finalIdentifier,
      description: formData.description,
      [updatedColumn]: new Date().toISOString(),
    };
    if (includeFoundryAlias) payload.foundry_alias = formData.foundryAlias.trim();
    if (includeSource) {
      payload.source = formData.source;
      payload.page = formData.page === '' ? null : Number(formData.page);
    }
    if (includeBasicRules) payload.basic_rules = formData.basicRules ? 1 : 0;
    if (includeOrder) payload[orderColumn] = formData.order === '' ? null : Number(formData.order);
    if (includeAbility) payload.ability_id = abilityId;
    if (categoryFK) payload[categoryFK.column] = formData.categoryId || null;
    if (categoryFreeText) payload[categoryFreeText.column] = formData.categoryText.trim() || null;
    if (buildExtraPayload) Object.assign(payload, buildExtraPayload(formData));

    const targetId = editingId || crypto.randomUUID();
    setSaving(true);
    try {
      await upsertDocument(table, targetId, payload);
      const stateRow = { id: targetId, ...payload };
      setEntries((prev) => {
        if (editingId) {
          return prev.map((row) => (row.id === targetId ? stateRow : row));
        }
        return [...prev, stateRow].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      });
      toast.success(`${singular} ${editingId ? 'updated' : 'created'}`);
      closeModal();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[ProficiencyEntityShell:${table}] save failed:`, err);
      toast.error(`Failed to save ${singular.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  // The destructive confirmation lives in <ConfirmDialog>. Both the
  // list-row trash button and the modal's Delete button call
  // `requestDelete(id)` to open the dialog; `confirmDelete()` runs
  // the actual mutation when the user confirms. Rejections from
  // deleteDocument are surfaced via toast and re-thrown so the
  // ConfirmDialog stays open (per its onConfirm contract).
  const requestDelete = (id: string) => setPendingDeleteId(id);

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    try {
      await deleteDocument(table, id);
      setEntries((prev) => prev.filter((row) => row.id !== id));
      if (editingId === id) closeModal();
      toast.success(`${singular} deleted`);
      setPendingDeleteId(null);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[ProficiencyEntityShell:${table}] delete failed:`, err);
      toast.error(`Failed to delete ${singular.toLowerCase()}`);
      throw err; // keeps the ConfirmDialog open for retry
    }
  };

  // Lookup used by the confirm dialog's description so the user can
  // see exactly which row they're about to remove.
  const pendingDeleteEntry = pendingDeleteId
    ? entries.find((e) => e.id === pendingDeleteId)
    : null;

  // ── Derived: filtered + sorted visible rows ──────────────────────────────
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = !q
      ? entries
      : entries.filter((r) => {
          const ability = attributes.find((a) => a.id === r.ability_id)?.identifier || '';
          return (
            (r.name || '').toLowerCase().includes(q) ||
            (r.identifier || '').toLowerCase().includes(q) ||
            (r.foundry_alias || '').toLowerCase().includes(q) ||
            ability.toLowerCase().includes(q)
          );
        });
    const sorted = [...filtered].sort((a, b) => {
      // Numeric ordering for `order` so 2 < 10. Null sorts last.
      if (sortKey === 'order') {
        const an = typeof a[orderColumn] === 'number' ? a[orderColumn] : Number.POSITIVE_INFINITY;
        const bn = typeof b[orderColumn] === 'number' ? b[orderColumn] : Number.POSITIVE_INFINITY;
        if (an < bn) return sortDir === 'asc' ? -1 : 1;
        if (an > bn) return sortDir === 'asc' ? 1 : -1;
        return 0;
      }
      let av: string;
      let bv: string;
      if (sortKey === 'ability') {
        av = attributes.find((x) => x.id === a.ability_id)?.identifier || '';
        bv = attributes.find((x) => x.id === b.ability_id)?.identifier || '';
      } else {
        av = String(a[sortKey] || '').toLowerCase();
        bv = String(b[sortKey] || '').toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [entries, attributes, search, sortKey, sortDir]);

  // ── Dynamic table columns based on which features the editor uses ────────
  //
  // Built fresh on every render — cheap, and avoids stale closures over
  // formData/categoryOptions inside the per-row `render` callbacks.
  // EntityListSection owns the breakpoint filter (via `minBreakpoint`),
  // the grid-template-columns math, the toolbar, and the sort headers;
  // we just declare the cells.
  const columns: ColumnDef<any>[] = [
    {
      key: 'name',
      label: 'Name',
      width: 'minmax(0,1fr)',
      sortable: true,
      minBreakpoint: 'always',
      render: (entry) => (
        <div className="text-xs font-bold text-ink truncate">{entry.name}</div>
      ),
    },
    {
      key: 'identifier',
      label: 'Identifier',
      width: '140px',
      sortable: true,
      minBreakpoint: 'sm',
      render: (entry) => (
        <div className="text-[10px] text-ink/55 font-mono truncate">
          {entry.identifier}
        </div>
      ),
    },
  ];
  if (includeOrder) {
    columns.push({
      key: 'order',
      label: 'Order',
      width: '60px',
      sortable: true,
      minBreakpoint: 'sm',
      render: (entry) => (
        <div className="text-[10px] text-ink/65 font-mono">
          {typeof entry[orderColumn] === 'number' ? entry[orderColumn] : '—'}
        </div>
      ),
    });
  }
  if (includeAbility) {
    columns.push({
      key: 'ability',
      label: 'Ability',
      width: '60px',
      sortable: true,
      minBreakpoint: 'md',
      render: (entry) => {
        const ability = attributes.find((a) => a.id === entry.ability_id)?.identifier;
        return <div className="text-[10px] font-bold text-gold">{ability || '—'}</div>;
      },
    });
  }
  if (categoryFK || categoryFreeText) {
    const label = categoryFK?.label ?? categoryFreeText!.label;
    columns.push({
      key: 'category',
      label,
      width: '120px',
      minBreakpoint: 'md',
      render: (entry) => {
        let display: string | null = null;
        if (categoryFK) {
          display =
            categoryOptions.find((c) => c.id === entry[categoryFK.column])?.name ||
            null;
        } else if (categoryFreeText) {
          display = entry[categoryFreeText.column] || null;
        }
        return <div className="text-[10px] text-ink/75 truncate">{display || '—'}</div>;
      },
    });
  }
  if (includeFoundryAlias) {
    columns.push({
      key: 'foundry',
      label: 'Foundry',
      width: '70px',
      minBreakpoint: 'lg',
      render: (entry) => (
        <div className="text-[10px] text-ink/55 font-mono">
          {entry.foundry_alias || '—'}
        </div>
      ),
    });
  }
  if (includeSource) {
    columns.push({
      key: 'source',
      label: 'Source',
      width: '90px',
      minBreakpoint: 'md',
      render: (entry) => (
        <div className="text-[10px] text-ink/65">
          {entry.source || '—'}
          {entry.page ? ` p.${entry.page}` : ''}
        </div>
      ),
    });
  }
  columns.push({
    key: 'actions',
    label: '',
    width: '48px',
    minBreakpoint: 'always',
    render: (entry) => (
      <div className="flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            requestDelete(entry.id);
          }}
          className="text-blood p-1 hover:bg-blood/10 rounded"
          title="Delete"
          type="button"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    ),
  });

  // Flip-or-set sort behavior. EntityListSection calls onSortChange
  // with the column key; we treat it as a SortKey and update state.
  const handleSortChange = (key: string) => {
    const next = key as SortKey;
    if (sortKey === next) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(next);
      setSortDir('asc');
    }
  };

  // ── Guards ───────────────────────────────────────────────────────────────
  if (!authorized) {
    return <div className="text-center py-20">Access Denied. Admins only.</div>;
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={hideHeader ? 'h-full flex flex-col min-h-0' : 'max-w-6xl mx-auto space-y-6 pb-20'}>
      {!hideHeader && (
        <>
          <div className="flex items-center gap-3 text-gold mb-2">
            <Icon className="w-6 h-6" />
            <span className="text-sm font-bold uppercase tracking-[0.3em]">Compendium</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2">
              {backLink && (
                <div className="flex items-center gap-4 mb-2">
                  <Link to={backLink.href}>
                    <Button variant="ghost" size="sm" className="text-gold gap-2 hover:bg-gold/5">
                      <ChevronLeft className="w-4 h-4" /> {backLink.label}
                    </Button>
                  </Link>
                </div>
              )}
              <h1 className="text-4xl font-serif font-bold text-ink tracking-tight uppercase">
                {singular} Manager
              </h1>
              <p className="text-ink/65 font-serif italic">{description}</p>
            </div>
          </div>
        </>
      )}

      {/* List section — fills remaining height when embedded. The
          shared EntityListSection owns the toolbar, sortable header,
          and body rows; we declare the per-column render callbacks
          above and let it handle responsive visibility internally. */}
      <EntityListSection
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={`Search ${plural.toLowerCase()}…`}
        visibleCount={visible.length}
        totalCount={entries.length}
        createLabel={`New ${singular}`}
        onCreate={openCreate}
        columns={columns}
        rows={visible}
        rowKey={(entry) => entry.id}
        rowTitle={(entry) => entry.description || ''}
        onRowClick={openEdit}
        sortKey={sortKey}
        sortDir={sortDir}
        onSortChange={handleSortChange}
        loading={loading}
        emptyState={
          <div className="empty-state mx-3 my-4">
            <Icon className="w-8 h-8 text-gold/25 mb-3" />
            <p className="description-text text-ink/45 mb-3">
              No {plural.toLowerCase()} defined yet.
            </p>
            <Button
              onClick={openCreate}
              size="sm"
              className="btn-gold-solid h-8 text-xs gap-1.5"
            >
              <Plus className="w-3 h-3" /> Create the first {singular.toLowerCase()}
            </Button>
          </div>
        }
        noMatchMessage={`No ${plural.toLowerCase()} match “${search}”.`}
        fillContainer
      />

      {/* Modal — Dialog primitive owns its mount/portal/escape/focus */}
      <ModalForm
        open={modalOpen}
        onOpenChange={(next) => {
          // Controlled-state contract: always propagate the requested
          // value back to state. If the Dialog primitive ever wants to
          // sync `open=true` internally (focus restoration, animation
          // bookkeeping) but we only respond to `false`, the popup gets
          // wedged in a half-closed state with no visible chrome.
          setModalOpen(next);
          if (!next) setEditingId(null);
        }}
        icon={Icon}
        singular={singular}
        editingId={editingId}
        formData={formData}
        setFormData={setFormData}
        attributes={attributes}
        categoryFK={categoryFK}
        categoryFreeText={categoryFreeText}
        categoryOptions={categoryOptions}
        categorySuggestions={categorySuggestions}
        sources={sources}
        includeAbility={includeAbility}
        includeFoundryAlias={includeFoundryAlias}
        includeSource={includeSource}
        includeBasicRules={includeBasicRules}
        includeOrder={includeOrder}
        renderExtraFields={renderExtraFields}
        renderExtraBadges={renderExtraBadges}
        lookups={lookups}
        saving={saving}
        onSave={handleSave}
        onDelete={editingId ? () => requestDelete(editingId) : undefined}
        currentEntry={editingId ? entries.find((e) => e.id === editingId) : null}
      />

      {/* Destructive-action confirmation — styled like the rest of the
          app. Used for both the inline list-row delete and the modal's
          Delete button. */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDeleteId(null);
        }}
        title={`Delete this ${singular.toLowerCase()}?`}
        description={
          pendingDeleteEntry?.name ? (
            <>
              You're about to remove{' '}
              <strong className="text-ink">{pendingDeleteEntry.name}</strong>.
              This can't be undone.
            </>
          ) : (
            'This action cannot be undone.'
          )
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

interface ModalFormProps<T extends Record<string, any>> {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  icon: LucideIcon;
  singular: string;
  editingId: string | null;
  formData: StandardProficiencyForm & T;
  setFormData: Dispatch<SetStateAction<StandardProficiencyForm & T>>;
  attributes: any[];
  categoryFK?: CategoryFKConfig;
  categoryFreeText?: CategoryFreeTextConfig;
  categoryOptions: any[];
  categorySuggestions: any[];
  sources: any[];
  includeAbility: boolean;
  includeFoundryAlias: boolean;
  includeSource: boolean;
  includeBasicRules: boolean;
  includeOrder: boolean;
  renderExtraFields?: (args: {
    formData: StandardProficiencyForm & T;
    setFormData: Dispatch<SetStateAction<StandardProficiencyForm & T>>;
    lookups: Record<string, any[]>;
  }) => ReactNode;
  renderExtraBadges?: (args: {
    entry: any;
    lookups: Record<string, any[]>;
  }) => ReactNode;
  lookups: Record<string, any[]>;
  saving: boolean;
  onSave: (e?: React.FormEvent) => void | Promise<void>;
  onDelete?: () => void;
  currentEntry: any;
}

function ModalForm<T extends Record<string, any>>({
  open,
  onOpenChange,
  icon: Icon,
  singular,
  editingId,
  formData,
  setFormData,
  attributes,
  categoryFK,
  categoryFreeText,
  categoryOptions,
  categorySuggestions,
  sources,
  includeAbility,
  includeFoundryAlias,
  includeSource,
  includeBasicRules,
  includeOrder,
  renderExtraFields,
  renderExtraBadges,
  lookups,
  saving,
  onSave,
  onDelete,
  currentEntry,
}: ModalFormProps<T>) {
  // Hero header — the rich variant with an icon tile, the
  // editing/new label, the (visible) DialogTitle showing the
  // working name, and an identifier/source chip row. Passed as
  // EntityEditModal's `headerSlot` to replace the default minimal
  // title bar; the slot owns its own DialogTitle / DialogDescription
  // and close affordance (DialogClose) because the modal only
  // wires those automatically in the default-header path.
  const heroSlot = (
    <>
      <div className="flex items-start gap-3 sm:gap-4 pr-8">
        <div className="flex flex-col items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 border-gold/45 bg-gold/15 shrink-0">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 text-gold" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="label-text text-gold/75 mb-0.5">
            {editingId ? `Editing ${singular}` : `New ${singular}`}
          </div>
          <DialogTitle className="dialog-title text-lg sm:text-2xl text-ink leading-tight truncate">
            {formData.name || `Untitled ${singular}`}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {editingId
              ? `Edit the ${singular.toLowerCase()} details below.`
              : `Create a new ${singular.toLowerCase()}.`}
          </DialogDescription>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {formData.identifier && (
              <span className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/55 rounded border border-ink/15 font-mono">
                {formData.identifier}
              </span>
            )}
            {formData.source && (
              <span className="text-[10px] text-ink/55">
                {formData.source}
                {formData.page ? ` p.${formData.page}` : ''}
              </span>
            )}
            {currentEntry &&
              renderExtraBadges &&
              renderExtraBadges({ entry: currentEntry, lookups })}
          </div>
        </div>
      </div>
      <DialogClose
        className="absolute top-3 right-3 text-ink/45 hover:text-ink p-1 rounded hover:bg-ink/5 transition-colors"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </DialogClose>
    </>
  );

  return (
    <EntityEditModal
      open={open}
      onOpenChange={onOpenChange}
      onSubmit={onSave}
      headerSlot={heroSlot}
      srTitle={
        editingId
          ? `Editing ${formData.name || singular.toLowerCase()}`
          : `New ${singular.toLowerCase()}`
      }
      srDescription={
        editingId
          ? `Edit the ${singular.toLowerCase()} details below.`
          : `Create a new ${singular.toLowerCase()}.`
      }
      isEditing={!!editingId}
      saveLabel={editingId ? 'Save Changes' : `Create ${singular}`}
      saving={saving}
      onDelete={onDelete}
    >
      {/* Body sections. EntityEditModal owns the surrounding
          dialog-body wrapper (custom-scrollbar + space-y-5 between
          sections), so the children below are just the form
          sections — Identity, Categorization, Description, the
          opt-in extras, and Metadata. */}
            {/* Identity */}
            <section className="space-y-3">
              <FormSectionHeading>Identity</FormSectionHeading>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="field-label">Name</label>
                  <Input
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((s) => ({ ...s, name: e.target.value }))
                    }
                    placeholder={`e.g. ${singular}`}
                    className="field-input h-10 text-sm"
                    required
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="field-label">Identifier</label>
                  <Input
                    value={formData.identifier}
                    onChange={(e) =>
                      setFormData((s) => ({ ...s, identifier: e.target.value }))
                    }
                    placeholder="auto-generated from name"
                    className="field-input text-xs font-mono"
                  />
                  <p className="field-hint">
                    Permanent slug used by the Foundry exporter.
                  </p>
                </div>
                {includeFoundryAlias && (
                  <div className="space-y-1">
                    <label className="field-label">Foundry Alias</label>
                    <Input
                      value={formData.foundryAlias}
                      onChange={(e) =>
                        setFormData((s) => ({
                          ...s,
                          foundryAlias: e.target.value,
                        }))
                      }
                      placeholder="3 chars"
                      maxLength={3}
                      className="field-input text-xs font-mono"
                    />
                    <p className="field-hint">
                      e.g. <code>acr</code>, <code>ath</code>, <code>arc</code>.
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Categorization */}
            {(includeAbility || categoryFK || categoryFreeText || includeSource) && (
              <section className="space-y-3">
                <FormSectionHeading>Categorization</FormSectionHeading>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {includeAbility && (
                    <div className="space-y-1">
                      <label className="field-label">Ability Score</label>
                      <select
                        value={formData.abilityIdentifier}
                        onChange={(e) =>
                          setFormData((s) => ({
                            ...s,
                            abilityIdentifier: e.target.value,
                          }))
                        }
                        className="field-input w-full px-3 rounded-md border focus:border-gold outline-none text-sm"
                      >
                        {attributes.map((a) => (
                          <option key={a.id} value={a.identifier}>
                            {a.identifier}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {categoryFK && (
                    <div className="space-y-1">
                      <label className="field-label">{categoryFK.label}</label>
                      <select
                        value={formData.categoryId}
                        onChange={(e) =>
                          setFormData((s) => ({
                            ...s,
                            categoryId: e.target.value,
                          }))
                        }
                        className="field-input w-full px-3 rounded-md border focus:border-gold outline-none text-sm"
                        required={!!categoryFK.required}
                      >
                        {!categoryFK.required && (
                          <option value="">— None —</option>
                        )}
                        {categoryOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {categoryOptions.length === 0 && (
                        <p className="field-hint">
                          Define {categoryFK.label.toLowerCase()}s in their
                          own tab first.
                        </p>
                      )}
                    </div>
                  )}
                  {categoryFreeText && (
                    <div className="space-y-1">
                      <label className="field-label">
                        {categoryFreeText.label}
                      </label>
                      <Input
                        list={`${categoryFreeText.column}-suggestions`}
                        value={formData.categoryText}
                        onChange={(e) =>
                          setFormData((s) => ({
                            ...s,
                            categoryText: e.target.value,
                          }))
                        }
                        className="field-input text-sm"
                        required={!!categoryFreeText.required}
                      />
                      {categorySuggestions.length > 0 && (
                        <datalist id={`${categoryFreeText.column}-suggestions`}>
                          {categorySuggestions.map((c) => (
                            <option key={c.id} value={c.name} />
                          ))}
                        </datalist>
                      )}
                    </div>
                  )}
                  {includeSource && <div className="space-y-1">
                    <label className="field-label">Source</label>
                    <div className="grid grid-cols-[1fr_72px] gap-2">
                      {/* Use abbreviation as the stored value to stay
                          compatible with existing rows (e.g., "PHB").
                          If a saved value doesn't match any current
                          source (legacy / custom), surface it as its
                          own option so the field doesn't appear empty
                          on edit. */}
                      {(() => {
                        const matched = sources.find(
                          (s) => (s.abbreviation || s.slug || s.name) === formData.source,
                        );
                        return (
                          <select
                            value={formData.source}
                            onChange={(e) =>
                              setFormData((s) => ({ ...s, source: e.target.value }))
                            }
                            className="field-input w-full px-3 rounded border focus:border-gold outline-none text-sm"
                          >
                            {sources.length === 0 && (
                              <option value={formData.source || ''}>
                                {formData.source || 'Loading…'}
                              </option>
                            )}
                            {!matched && formData.source && (
                              <option value={formData.source}>
                                {formData.source} (legacy)
                              </option>
                            )}
                            {sources.map((source) => {
                              const value =
                                source.abbreviation || source.slug || source.name;
                              const label = source.abbreviation
                                ? `${source.abbreviation} — ${source.name}`
                                : source.name || source.slug;
                              return (
                                <option key={source.id} value={value}>
                                  {label}
                                </option>
                              );
                            })}
                          </select>
                        );
                      })()}
                      <Input
                        type="number"
                        value={formData.page === '' ? '' : formData.page}
                        onChange={(e) =>
                          setFormData((s) => ({
                            ...s,
                            page: e.target.value === ''
                              ? ''
                              : Number(e.target.value),
                          }))
                        }
                        placeholder="page"
                        className="field-input text-sm"
                      />
                    </div>
                  </div>}
                </div>
              </section>
            )}

            {/* Description — uses the site's rich text editor with the
                formatting toolbar suppressed (proficiency descriptions
                are usually one or two sentences; the toolbar would be
                visual noise). BBCode storage round-trip is preserved. */}
            <section className="space-y-2">
              <FormSectionHeading>Description</FormSectionHeading>
              <MarkdownEditor
                value={formData.description}
                onChange={(val) =>
                  setFormData((s) => ({ ...s, description: val }))
                }
                placeholder={`What this ${singular.toLowerCase()} is used for.`}
                hideToolbar
                minHeight="120px"
                maxHeight="240px"
                autoSizeToContent={false}
              />
            </section>

            {/* Entity-specific extras */}
            {renderExtraFields && (
              <section className="space-y-2">
                <FormSectionHeading>{singular} Details</FormSectionHeading>
                {renderExtraFields({ formData, setFormData, lookups })}
              </section>
            )}

            {/* Metadata — only renders when at least one metadata
                field is active (Basic Rules toggle and/or Order). */}
            {(includeBasicRules || includeOrder) && (
              <section className="space-y-3">
                <FormSectionHeading>Metadata</FormSectionHeading>
                {includeOrder && (
                  <div className="space-y-1 max-w-[180px]">
                    <label className="field-label">Display Order</label>
                    <Input
                      type="number"
                      value={formData.order === '' ? '' : formData.order}
                      onChange={(e) =>
                        setFormData((s) => ({
                          ...s,
                          order: e.target.value === '' ? '' : Number(e.target.value),
                        }))
                      }
                      placeholder="e.g. 1"
                      className="field-input text-sm font-mono"
                    />
                    <p className="field-hint">
                      Lower numbers appear first. Leave blank to sort by
                      name only.
                    </p>
                  </div>
                )}
                {includeBasicRules && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.basicRules}
                      onChange={(e) =>
                        setFormData((s) => ({ ...s, basicRules: e.target.checked }))
                      }
                      className="rounded border-gold/25 text-gold focus:ring-gold"
                    />
                    <span className="text-sm text-ink/75">
                      Include in Basic Rules export
                    </span>
                  </label>
                )}
              </section>
            )}
    </EntityEditModal>
  );
}
