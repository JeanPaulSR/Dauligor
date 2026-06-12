// =============================================================================
// ModuleExportManager — admin "rebake a whole system" controls.
// =============================================================================
//
// Editor saves auto-enqueue a debounced rebake (1h after the last edit) which
// a frequent cron drains GRADUALLY (a few per sweep, so Cloudflare never gets
// a burst). That covers content edits. A *code* change to the export pipeline,
// though, touches no entity rows — so nothing self-enqueues and the cached
// bundles keep serving the old shape. These buttons close that gap: they
// bulk-enqueue every entity of a kind (due immediately, but without pulling an
// in-flight edit forward), then the same cron drains them slowly.
//
// Backend: POST /api/module/queue-rebake-kind → enqueueAllOfKind →
// module_export_queue → cron POST /api/admin/process-export-queue.
// =============================================================================

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { rebakeKind } from '../../lib/moduleExport';
import { Boxes, Library, Loader2, RefreshCw } from 'lucide-react';

interface Props {
  userProfile?: { role?: string } | null;
}

type Kind = 'class' | 'source';

const ACTIONS: { kind: Kind; label: string; icon: any; blurb: string }[] = [
  {
    kind: 'class',
    label: 'Rebake all classes',
    icon: Boxes,
    blurb:
      'Re-queues every class. Each class bundle embeds its features, subclasses, and unique options, so this is the one to use after a class / feature export-logic change.',
  },
  {
    kind: 'source',
    label: 'Rebake all sources',
    icon: Library,
    blurb:
      'Re-queues every source — refreshes the top-level + per-source catalogs and every class in each book. Heavier; use after a catalog or source-shape change.',
  },
];

export default function ModuleExportManager({ userProfile }: Props) {
  const isAdmin = userProfile?.role === 'admin' || userProfile?.role === 'co-dm';
  const [busy, setBusy] = useState<Kind | null>(null);

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center text-ink/55">
        This page is restricted to admins and co-DMs.
      </div>
    );
  }

  const run = async (kind: Kind) => {
    setBusy(kind);
    try {
      const res = await rebakeKind(kind);
      if (res.ok) {
        toast.success(`Queued ${res.count} ${kind === 'class' ? 'classes' : 'sources'} for rebake — draining gradually.`);
      } else {
        toast.error(res.error || 'Rebake request failed.');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="font-serif text-3xl font-bold uppercase tracking-tight text-gold flex items-center gap-3">
          <RefreshCw className="w-7 h-7" /> Foundry Export — Rebake
        </h1>
        <p className="text-sm text-ink/60">
          Refresh the cached Foundry export bundles for a whole system after an export-logic change.
        </p>
      </header>

      <div className="config-fieldset bg-background/20">
        <p className="text-[13px] text-ink/70 leading-relaxed">
          Editor saves already auto-queue a rebake <strong>1&nbsp;hour after the last edit</strong>, and a cron
          drains the queue <strong>gradually</strong> (a few per sweep). You only need these buttons after a
          <em> code</em> change to the export pipeline — that changes the output but touches no entity row, so
          nothing self-queues. Bulk-enqueuing is cheap and safe; the actual rebakes spread out over the next
          sweeps, and anything you're actively editing keeps its own 1-hour window.
        </p>
      </div>

      <div className="space-y-3">
        {ACTIONS.map(({ kind, label, icon: Icon, blurb }) => (
          <div key={kind} className="config-fieldset bg-background/10 flex items-start gap-4">
            <Icon className="w-5 h-5 text-gold/70 mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-ink">{label}</div>
              <p className="text-[12px] text-ink/55 mt-0.5 leading-snug">{blurb}</p>
            </div>
            <Button
              onClick={() => run(kind)}
              disabled={busy !== null}
              className="btn-gold-solid shrink-0 min-w-[120px]"
            >
              {busy === kind ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Queue rebake'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
