import { Crosshair } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import WeaponTypeSelect, {
  WeaponType,
} from '../../components/compendium/WeaponTypeSelect';
import WeaponPropertiesPicker from '../../components/compendium/WeaponPropertiesPicker';

interface WeaponExtras {
  weaponType: WeaponType;
  propertyIds: string[];
}

const WEAPON_DEFAULTS: WeaponExtras = {
  weaponType: 'Melee',
  propertyIds: [],
};

// `property_ids` is auto-parsed by d1.ts, but a defensive parse here
// keeps the render safe when a row arrives via a path that bypasses
// queryD1's auto-parse (e.g., stale in-memory cache entries seeded
// before the JSON column was added to the auto-parse list).
function readPropertyIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function WeaponsEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell<WeaponExtras>
      userProfile={userProfile}
      table="weapons"
      singular="Weapon"
      plural="Weapons"
      icon={Crosshair}
      description="Define the weapons available in your game system."
      hideHeader={hideHeader}
      categoryFK={{
        column: 'category_id',
        referenceTable: 'weaponCategories',
        label: 'Category',
        required: true,
      }}
      extraLookups={[{ key: 'properties', collection: 'weaponProperties' }]}
      extraDefaults={WEAPON_DEFAULTS}
      hydrateExtras={(entry) => ({
        weaponType: (entry.weapon_type as WeaponType) || 'Melee',
        propertyIds: readPropertyIds(entry.property_ids),
      })}
      buildExtraPayload={(form) => ({
        weapon_type: form.weaponType,
        property_ids: form.propertyIds,
      })}
      renderExtraFields={({ formData, setFormData, lookups }) => (
        <>
          <WeaponTypeSelect
            value={formData.weaponType}
            onChange={(next) =>
              setFormData((s) => ({ ...s, weaponType: next }))
            }
          />
          <WeaponPropertiesPicker
            value={formData.propertyIds}
            options={lookups.properties || []}
            onChange={(ids) =>
              setFormData((s) => ({ ...s, propertyIds: ids }))
            }
          />
        </>
      )}
      renderExtraBadges={({ entry, lookups }) => (
        <>
          {entry.weapon_type && (
            <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold">
              {entry.weapon_type}
            </span>
          )}
          {readPropertyIds(entry.property_ids).map((pid: string) => {
            const prop = (lookups.properties || []).find(
              (p: any) => p.id === pid,
            );
            if (!prop) return null;
            return (
              <span
                key={pid}
                title={prop.description}
                className="text-[9px] px-1.5 py-0.5 bg-ink/5 border border-ink/10 text-ink/60 rounded uppercase tracking-tighter cursor-help"
              >
                {prop.name}
              </span>
            );
          })}
        </>
      )}
    />
  );
}
