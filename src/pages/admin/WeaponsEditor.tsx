import { Crosshair } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import WeaponTypeSelect, {
  WeaponType,
} from '../../components/compendium/WeaponTypeSelect';
import WeaponPropertiesPicker from '../../components/compendium/WeaponPropertiesPicker';
import WeaponMechanicsFields, {
  WEAPON_MECHANICS_DEFAULTS,
  type WeaponMechanicsState,
} from '../../components/compendium/WeaponMechanicsFields';

/**
 * Weapon editor — admin surface for the `weapons` table. As of
 * migration 20260524-1800 the form covers:
 *   - Existing fields: weaponType (Melee/Ranged), propertyIds[]
 *   - Foundry root-level stats: damage, range, mastery, magicalBonus
 *   - Shared item shell: weight, price, rarity, attunement, baseItem
 *
 * The mechanics shape matches dnd5e v5's `system.*` exactly so a
 * future weapon exporter can round-trip without unflattening.
 */

interface WeaponExtras extends WeaponMechanicsState {
  weaponType: WeaponType;
  propertyIds: string[];
}

const WEAPON_DEFAULTS: WeaponExtras = {
  weaponType: 'Melee',
  propertyIds: [],
  ...WEAPON_MECHANICS_DEFAULTS,
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

// Defensive JSON-object reader for the nested columns (damage / range
// / weight / price). d1.ts auto-parses them, but a stale-cache row
// or a freshly-created entity row can have the raw JSON string OR
// `undefined`. Falls back to a default-shaped object so the
// downstream components don't trip on `undefined.value`.
function readJsonObj<T extends Record<string, any>>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
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
        damage: readJsonObj(entry.damage, WEAPON_MECHANICS_DEFAULTS.damage),
        range: readJsonObj(entry.range, WEAPON_MECHANICS_DEFAULTS.range),
        mastery: entry.mastery ?? '',
        magicalBonus: Number(entry.magical_bonus ?? 0) || 0,
        weight: readJsonObj(entry.weight, WEAPON_MECHANICS_DEFAULTS.weight),
        price: readJsonObj(entry.price, WEAPON_MECHANICS_DEFAULTS.price),
        rarity: entry.rarity ?? 'none',
        attunement: entry.attunement ?? '',
        baseItem: entry.base_item ?? '',
      })}
      buildExtraPayload={(form) => ({
        weapon_type: form.weaponType,
        property_ids: form.propertyIds,
        damage: form.damage,
        range: form.range,
        mastery: form.mastery || null,
        magical_bonus: form.magicalBonus,
        weight: form.weight,
        price: form.price,
        rarity: form.rarity,
        attunement: form.attunement || null,
        base_item: form.baseItem || null,
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
          <WeaponMechanicsFields
            state={{
              damage: formData.damage,
              range: formData.range,
              mastery: formData.mastery,
              magicalBonus: formData.magicalBonus,
              weight: formData.weight,
              price: formData.price,
              rarity: formData.rarity,
              attunement: formData.attunement,
              baseItem: formData.baseItem,
            }}
            onChange={(next) =>
              setFormData((s) => ({
                ...s,
                damage: next.damage,
                range: next.range,
                mastery: next.mastery,
                magicalBonus: next.magicalBonus,
                weight: next.weight,
                price: next.price,
                rarity: next.rarity,
                attunement: next.attunement,
                baseItem: next.baseItem,
              }))
            }
          />
        </>
      )}
      renderExtraBadges={({ entry, lookups }) => (
        <>
          {entry.weapon_type && (
            <span className="text-[10px] px-2 py-0.5 bg-ink/15 text-ink/75 rounded-full font-bold">
              {entry.weapon_type}
            </span>
          )}
          {entry.rarity && entry.rarity !== 'none' && (
            <span className="text-[10px] px-2 py-0.5 bg-gold/15 text-gold rounded-full font-bold">
              {entry.rarity}
            </span>
          )}
          {entry.mastery && (
            <span className="text-[10px] px-2 py-0.5 bg-blood/10 text-blood/80 rounded-full font-bold">
              {entry.mastery}
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
                className="text-[9px] px-1.5 py-0.5 bg-ink/5 border border-ink/15 text-ink/65 rounded uppercase tracking-tighter cursor-help"
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
