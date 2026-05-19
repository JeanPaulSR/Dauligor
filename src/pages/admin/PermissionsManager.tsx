// =============================================================================
// PermissionsManager — additive-role grant editor.
// =============================================================================
//
// The existing `users.role` column stays a single value on the
// admin/co-dm/lore-writer/trusted-player/user ladder. Capabilities that
// don't fit that ladder (`content-creator` for Phase 1, more later)
// live in `user_permissions` rows and are managed here.
//
// Layout:
//   ┌──────────────┬───────────────────────────────────────────────┐
//   │ User list    │ Selected user's grants                        │
//   │ (search +    │  ┌─ content-creator ────────────────────────┐ │
//   │ rows w/ perm │  │ Scope picker (worlds / campaigns / eras) │ │
//   │ count badge) │  │ Save / Revoke                            │ │
//   │              │  └──────────────────────────────────────────┘ │
//   └──────────────┴───────────────────────────────────────────────┘
//
// Scope semantics:
//   - "Unrestricted on axis X" = axis omitted from the scope object
//   - "Narrowed to set" = scope.X = [ids]
//   - All axes unrestricted = scope is null (an unscoped grant)
//
// Phase 1 only ships one permission key (`content-creator`). The picker
// is built generic so adding new keys is a flat extension.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { auth } from '../../lib/firebase';
import { fetchCollection } from '../../lib/d1';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Check, KeyRound, Globe2, LayoutGrid, Clock, Search, X, ShieldPlus, Trash2 } from 'lucide-react';

type Scope = {
  worlds?: string[];
  campaigns?: string[];
  eras?: string[];
} | null;

type GrantedPermission = {
  permission_key: string;
  scope: Scope;
  granted_at: string | null;
  granted_by_user_id: string | null;
};

type User = {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  avatar_url: string | null;
  permission_keys?: string[];
};

type World = { id: string; name: string; slug: string; is_default: number };
type Era = { id: string; name: string };
type Campaign = { id: string; name: string };

// Phase 1 ships just one. Add to this map as new keys land; the
// server-side allowlist in `api/_lib/permissions.ts` is the source of
// truth — both must agree.
const PERMISSION_LABELS: Record<string, { label: string; description: string }> = {
  'content-creator': {
    label: 'Content Creator',
    description:
      'May propose changes to tags, spell rules, and class spell lists. Proposals enter a queue for admin approval; no direct writes.',
  },
};

const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS);

type AxisKey = 'worlds' | 'campaigns' | 'eras';

export default function PermissionsManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [eras, setEras] = useState<Era[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [grants, setGrants] = useState<GrantedPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [draftScopes, setDraftScopes] = useState<Record<string, Scope>>({});

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error('Not signed in.');
    return fetch(input, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });
  }, []);

  // Lookup tables — loaded once. Worlds + Eras + Campaigns are read
  // independently because each has its own endpoint shape: worlds is
  // admin-only with a list response; eras still flow through the
  // generic proxy; campaigns has its own staff endpoint.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [usersRes, worldsRes, campsRes] = await Promise.all([
          authedFetch('/api/admin/users'),
          authedFetch('/api/admin/worlds'),
          authedFetch('/api/campaigns'),
        ]);
        if (cancelled) return;
        if (usersRes.ok) {
          const body = await usersRes.json();
          setUsers(Array.isArray(body?.users) ? body.users : []);
        }
        if (worldsRes.ok) {
          const body = await worldsRes.json();
          setWorlds(Array.isArray(body?.worlds) ? body.worlds : []);
        }
        if (campsRes.ok) {
          const body = await campsRes.json();
          setCampaigns(Array.isArray(body?.campaigns) ? body.campaigns : []);
        }
        // Eras still ride the generic D1 proxy — read-only taxonomy,
        // public among signed-in users. `fetchCollection` already
        // attaches the auth token internally.
        const eraRows: any[] = await fetchCollection('eras');
        if (!cancelled) setEras(Array.isArray(eraRows) ? eraRows : []);
      } catch (err: any) {
        if (!cancelled) {
          console.error('Failed to load lookup tables:', err);
          toast.error(err?.message || 'Failed to load lookup tables.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authedFetch]);

  // Permissions for the selected user — refetched whenever the
  // selection changes. The draft scope state mirrors what's on the
  // server so the user can edit without an immediate write.
  const loadPermissions = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/admin/users/${encodeURIComponent(userId)}/permissions`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load permissions (HTTP ${res.status})`);
      }
      const body = await res.json();
      const list: GrantedPermission[] = Array.isArray(body?.permissions) ? body.permissions : [];
      setGrants(list);
      const draft: Record<string, Scope> = {};
      for (const g of list) draft[g.permission_key] = g.scope ?? null;
      setDraftScopes(draft);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to load permissions.');
      setGrants([]);
      setDraftScopes({});
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!selectedUserId) {
      setGrants([]);
      setDraftScopes({});
      return;
    }
    void loadPermissions(selectedUserId);
  }, [selectedUserId, loadPermissions]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        (u.username || '').toLowerCase().includes(q)
        || (u.display_name || '').toLowerCase().includes(q)
      );
    });
  }, [users, userSearch]);

  const selectedUser = useMemo(
    () => users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId],
  );

  // Reload the users list afterwards so the badge column on the
  // Users tab reflects the new state when the admin switches back.
  const reloadUsers = useCallback(async () => {
    const res = await authedFetch('/api/admin/users');
    if (res.ok) {
      const body = await res.json();
      setUsers(Array.isArray(body?.users) ? body.users : []);
    }
  }, [authedFetch]);

  const handleSaveGrant = async (key: string) => {
    if (!selectedUserId) return;
    setSavingKey(key);
    try {
      const scope = draftScopes[key] ?? null;
      const res = await authedFetch(
        `/api/admin/users/${encodeURIComponent(selectedUserId)}/permissions/${encodeURIComponent(key)}`,
        { method: 'PUT', body: JSON.stringify({ scope }) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to save grant (HTTP ${res.status})`);
      }
      toast.success(`${PERMISSION_LABELS[key]?.label || key} saved.`);
      await loadPermissions(selectedUserId);
      await reloadUsers();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to save grant.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleRevoke = async (key: string) => {
    if (!selectedUserId) return;
    if (!confirm(`Revoke "${PERMISSION_LABELS[key]?.label || key}" from this user?`)) return;
    setSavingKey(key);
    try {
      const res = await authedFetch(
        `/api/admin/users/${encodeURIComponent(selectedUserId)}/permissions/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to revoke (HTTP ${res.status})`);
      }
      toast.success(`${PERMISSION_LABELS[key]?.label || key} revoked.`);
      await loadPermissions(selectedUserId);
      await reloadUsers();
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || 'Failed to revoke.');
    } finally {
      setSavingKey(null);
    }
  };

  const isGranted = (key: string) => grants.some((g) => g.permission_key === key);

  return (
    <div className="grid grid-cols-12 gap-6">
      <Card className="col-span-12 lg:col-span-4 border-gold/10">
        <CardHeader>
          <CardTitle className="text-base font-bold uppercase tracking-widest flex items-center gap-2">
            <KeyRound className="w-4 h-4" />
            Users
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by username or display name"
              className="pl-9"
            />
          </div>
          <div className="max-h-[600px] overflow-y-auto space-y-1">
            {filteredUsers.map((u) => {
              const permCount = Array.isArray(u.permission_keys) ? u.permission_keys.length : 0;
              const isSelected = selectedUserId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-left transition-colors text-sm ${
                    isSelected
                      ? 'bg-gold/15 text-gold border border-gold/30'
                      : 'hover:bg-ink/5 border border-transparent'
                  }`}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="truncate font-medium">
                      {u.display_name || u.username || 'Unknown'}
                    </span>
                    <span className="truncate text-xs text-ink/50 font-mono">
                      @{u.username} · {u.role}
                    </span>
                  </div>
                  {permCount > 0 && (
                    <Badge variant="outline" className="ml-2 shrink-0 border-gold/30 text-gold">
                      +{permCount}
                    </Badge>
                  )}
                </button>
              );
            })}
            {filteredUsers.length === 0 && (
              <p className="text-sm text-ink/50 italic text-center py-8">
                No users match the search.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="col-span-12 lg:col-span-8 space-y-4">
        {!selectedUser ? (
          <Card className="border-gold/10">
            <CardContent className="py-20 text-center text-ink/50 italic">
              Pick a user from the list to manage their additive permissions.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className="border-gold/10">
              <CardHeader>
                <CardTitle className="text-base font-bold uppercase tracking-widest">
                  {selectedUser.display_name || selectedUser.username}
                </CardTitle>
                <p className="text-xs text-ink/50 font-mono">
                  Base role: <span className="text-ink/70">{selectedUser.role}</span> ·
                  ID <span className="text-ink/70">{selectedUser.id}</span>
                </p>
              </CardHeader>
              <CardContent className="text-xs text-ink/60 leading-relaxed">
                Permissions listed below stack on top of the base role.
                A user keeps every capability their role already grants;
                rows here only <em>add</em> capabilities (with optional
                scope narrowing) — they never take any away.
              </CardContent>
            </Card>

            {loading ? (
              <Card className="border-gold/10">
                <CardContent className="py-12 text-center text-ink/50 italic">Loading…</CardContent>
              </Card>
            ) : (
              PERMISSION_KEYS.map((key) => (
                <PermissionGrantCard
                  key={key}
                  permissionKey={key}
                  granted={isGranted(key)}
                  scope={draftScopes[key] ?? null}
                  setScope={(next) =>
                    setDraftScopes((prev) => ({ ...prev, [key]: next }))
                  }
                  worlds={worlds}
                  campaigns={campaigns}
                  eras={eras}
                  saving={savingKey === key}
                  onGrant={() => handleSaveGrant(key)}
                  onRevoke={() => handleRevoke(key)}
                />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* PermissionGrantCard                                                         */
/* -------------------------------------------------------------------------- */

function PermissionGrantCard({
  permissionKey,
  granted,
  scope,
  setScope,
  worlds,
  campaigns,
  eras,
  saving,
  onGrant,
  onRevoke,
}: {
  permissionKey: string;
  granted: boolean;
  scope: Scope;
  setScope: (next: Scope) => void;
  worlds: World[];
  campaigns: Campaign[];
  eras: Era[];
  saving: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}) {
  const meta = PERMISSION_LABELS[permissionKey] || { label: permissionKey, description: '' };

  // Axis toggles: "is this axis restricted?" The presence of the key
  // in scope decides; setting an axis to undefined removes the
  // narrowing (i.e. unrestricted on that axis).
  const isRestricted = (axis: AxisKey) =>
    !!scope && Array.isArray(scope[axis]);

  const toggleAxisRestriction = (axis: AxisKey, on: boolean) => {
    const next: Scope = scope ? { ...scope } : {};
    if (on) {
      if (!Array.isArray(next[axis])) next[axis] = [];
    } else {
      delete next[axis];
    }
    setScope(Object.keys(next).length === 0 ? null : next);
  };

  const toggleAxisValue = (axis: AxisKey, id: string) => {
    const current = scope?.[axis] || [];
    const next: Scope = scope ? { ...scope } : {};
    next[axis] = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setScope(next);
  };

  return (
    <Card className="border-gold/10">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldPlus className="w-4 h-4 text-gold" />
            {meta.label}
            {granted && <Badge className="bg-gold/15 text-gold border-gold/30">Granted</Badge>}
          </CardTitle>
          <p className="text-xs text-ink/60 mt-2 leading-relaxed">{meta.description}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ScopeAxisRow
          axisKey="worlds"
          axisLabel="Worlds"
          icon={Globe2}
          options={worlds.map((w) => ({
            id: w.id,
            label: w.name,
            badge: Number(w.is_default) === 1 ? 'Default' : undefined,
          }))}
          selected={scope?.worlds ?? null}
          restricted={isRestricted('worlds')}
          onToggleRestriction={(on) => toggleAxisRestriction('worlds', on)}
          onToggleValue={(id) => toggleAxisValue('worlds', id)}
        />
        <ScopeAxisRow
          axisKey="campaigns"
          axisLabel="Campaigns"
          icon={LayoutGrid}
          options={campaigns.map((c) => ({ id: c.id, label: c.name }))}
          selected={scope?.campaigns ?? null}
          restricted={isRestricted('campaigns')}
          onToggleRestriction={(on) => toggleAxisRestriction('campaigns', on)}
          onToggleValue={(id) => toggleAxisValue('campaigns', id)}
        />
        <ScopeAxisRow
          axisKey="eras"
          axisLabel="Eras"
          icon={Clock}
          options={eras.map((e) => ({ id: e.id, label: e.name }))}
          selected={scope?.eras ?? null}
          restricted={isRestricted('eras')}
          onToggleRestriction={(on) => toggleAxisRestriction('eras', on)}
          onToggleValue={(id) => toggleAxisValue('eras', id)}
        />

        <div className="flex justify-between items-center pt-2 border-t border-gold/10">
          <p className="text-xs text-ink/50 italic">
            {scope === null
              ? 'Unrestricted on every axis — the holder can act anywhere.'
              : `Narrowed: ${(['worlds', 'campaigns', 'eras'] as AxisKey[])
                  .filter((a) => Array.isArray(scope?.[a]))
                  .map((a) => `${a} (${scope?.[a]?.length ?? 0})`)
                  .join(', ') || 'no axes restricted'}.`}
          </p>
          <div className="flex gap-2">
            {granted && (
              <Button variant="outline" onClick={onRevoke} disabled={saving}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Revoke
              </Button>
            )}
            <Button onClick={onGrant} disabled={saving} className="bg-gold text-white">
              {saving ? 'Saving…' : granted ? 'Save Scope' : 'Grant'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* ScopeAxisRow                                                                */
/* -------------------------------------------------------------------------- */

function ScopeAxisRow({
  axisKey,
  axisLabel,
  icon: Icon,
  options,
  selected,
  restricted,
  onToggleRestriction,
  onToggleValue,
}: {
  axisKey: AxisKey;
  axisLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  options: Array<{ id: string; label: string; badge?: string }>;
  selected: string[] | null;
  restricted: boolean;
  onToggleRestriction: (on: boolean) => void;
  onToggleValue: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="w-4 h-4 text-ink/60" />
          {axisLabel}
          {!restricted && (
            <span className="text-xs text-ink/40 italic ml-2">unrestricted</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onToggleRestriction(!restricted)}
          className={`text-xs font-medium px-3 py-1 rounded-md transition-colors ${
            restricted
              ? 'bg-gold/15 text-gold border border-gold/30'
              : 'bg-ink/5 text-ink/60 border border-transparent hover:bg-ink/10'
          }`}
        >
          {restricted ? 'Narrow to set ▾' : 'Unrestricted'}
        </button>
      </div>
      {restricted && (
        <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-background/50 min-h-[40px]">
          {options.length === 0 ? (
            <p className="text-xs text-ink/40 italic">No {axisLabel.toLowerCase()} defined.</p>
          ) : (
            options.map((opt) => {
              const isOn = (selected || []).includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onToggleValue(opt.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                    isOn
                      ? 'bg-gold/20 text-gold border border-gold/30'
                      : 'bg-ink/5 text-ink/60 border border-transparent hover:bg-ink/10'
                  }`}
                >
                  {isOn ? <Check className="w-3 h-3" /> : <X className="w-3 h-3 opacity-30" />}
                  <span>{opt.label}</span>
                  {opt.badge && (
                    <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">
                      {opt.badge}
                    </Badge>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
