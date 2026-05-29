import React from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import ScalingMatrixEditor from '../../../components/compendium/ScalingMatrixEditor';

/**
 * Standalone scaling-column editor page
 * (`/compendium/scaling/new` · `/compendium/scaling/edit/:id`).
 *
 * Now a thin wrapper around the shared <ScalingMatrixEditor> widget. The
 * matrix editor was extracted into a widget so it can also mount in-place
 * (as a modal inside ScalingColumnsPanel) — which is the primary authoring
 * flow and keeps the editor inside the parent's proposal wrapper. This
 * route stays for back-compat + direct links; route params are read here
 * and passed as props.
 */
export default function ScalingEditor({ userProfile }: { userProfile: any }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const parentId = searchParams.get('parentId') || '';
  const parentType = searchParams.get('parentType') || 'class';

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        className="text-gold gap-2 hover:bg-gold/5"
      >
        <ChevronLeft className="w-4 h-4" /> Back
      </Button>
      <ScalingMatrixEditor
        columnId={id || null}
        parentId={parentId}
        parentType={parentType}
        userProfile={userProfile}
        onSaved={() => navigate(-1)}
        onDeleted={() => navigate(-1)}
      />
    </div>
  );
}
