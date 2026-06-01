import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Users } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

/**
 * Placeholder list page for /compendium/backgrounds.
 *
 * Backgrounds now live in their own `backgrounds` table (migration
 * 20260601-1200), edited via SpeciesBackgroundEditor. A full public
 * browser (header + FilterBar + virtualized list + detail panel,
 * patterned after FeatList) is planned for a later milestone, and the
 * catalog is populated by the Foundry-export importer. For now this stub
 * surfaces the admin "Manage" link so the editor is reachable while the
 * public surface catches up.
 */
export default function BackgroundsList({ userProfile }: { userProfile: any }) {
  const isAdmin = userProfile?.role === 'admin';
  const isContentCreator =
    !!userProfile?.permissions
    && Object.prototype.hasOwnProperty.call(userProfile.permissions, 'content-creator');
  const canManage = isAdmin || isContentCreator;

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-20 pt-4">
      <div className="flex items-center gap-3 text-gold">
        <Users className="h-6 w-6" />
        <span className="text-xs font-bold uppercase tracking-[0.3em]">Compendium</span>
      </div>

      <h1 className="h1-title">Backgrounds</h1>

      <Card className="border-gold/10 bg-card/50">
        <CardContent className="space-y-4 px-6 py-10 text-center">
          <p className="font-serif italic text-ink/70 text-lg">
            The backgrounds compendium browser is coming soon.
          </p>
          <p className="text-sm text-ink/55 max-w-xl mx-auto">
            Backgrounds have their own dedicated
            <code className="mx-1 rounded bg-background/40 px-1.5 py-0.5 font-mono text-[11px] text-gold">backgrounds</code>
            table now (wealth, starting equipment, and advancement
            grants). The public list page is planned for a later
            milestone, but admins / content-creators can author entries
            today via the editor below.
          </p>
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
            <Link to="/compendium">
              <Button variant="outline" size="sm" className="gap-2 border-gold/20 text-gold hover:bg-gold/5">
                <ChevronLeft className="h-4 w-4" />
                Back to Compendium
              </Button>
            </Link>
            {canManage && (
              <Link to="/compendium/backgrounds/manage">
                <Button type="button" variant="outline" size="sm" className="h-8 border-gold/20 text-gold hover:bg-gold/5">
                  Background Manager
                </Button>
              </Link>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
