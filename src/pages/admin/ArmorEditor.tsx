import { ShieldCheck } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import ArmorMechanicsFields, {
  ARMOR_MECHANICS_DEFAULTS,
  type ArmorMechanicsState,
} from '../../components/compendium/ArmorMechanicsFields';

/**
 * Armor editor — admin surface for the `armor` table. As of migration
 * 20260524-1800 the form covers Foundry's full equipment-armor shape:
 *   - system.armor.{value, dex, magicalBonus}
 *   - system.strength (STR requirement)
 *   - system.stealth (disadvantage flag)
 *   - system.type.value (light/medium/heavy/shield/natural/clothing/trinket/wondrous)
 *   - Plus shared item shell: weight, price, rarity, attunement, baseItem
 */

type ArmorExtras = ArmorMechanicsState;

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

export default function ArmorEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell<ArmorExtras>
      userProfile={userProfile}
      table="armor"
      singular="Armor"
      plural="Armor"
      icon={ShieldCheck}
      description="Define the armor available in your game system."
      hideHeader={hideHeader}
      categoryFK={{
        column: 'category_id',
        referenceTable: 'armorCategories',
        label: 'Category',
        required: true,
      }}
      extraDefaults={ARMOR_MECHANICS_DEFAULTS}
      hydrateExtras={(entry) => ({
        armorValue: Number(entry.armor_value ?? 10) || 10,
        armorDex: entry.armor_dex === null || entry.armor_dex === undefined ? null : Number(entry.armor_dex),
        armorMagicalBonus: Number(entry.armor_magical_bonus ?? 0) || 0,
        strength: entry.strength === null || entry.strength === undefined ? null : Number(entry.strength),
        stealth: !!entry.stealth,
        armorType: entry.armor_type ?? 'light',
        weight: readJsonObj(entry.weight, ARMOR_MECHANICS_DEFAULTS.weight),
        price: readJsonObj(entry.price, ARMOR_MECHANICS_DEFAULTS.price),
        rarity: entry.rarity ?? 'none',
        attunement: entry.attunement ?? '',
        baseItem: entry.base_item ?? '',
      })}
      buildExtraPayload={(form) => ({
        armor_value: form.armorValue,
        armor_dex: form.armorDex,
        armor_magical_bonus: form.armorMagicalBonus,
        strength: form.strength,
        stealth: form.stealth ? 1 : 0,
        armor_type: form.armorType,
        weight: form.weight,
        price: form.price,
        rarity: form.rarity,
        attunement: form.attunement || null,
        base_item: form.baseItem || null,
      })}
      renderExtraFields={({ formData, setFormData }) => (
        <ArmorMechanicsFields
          state={formData}
          onChange={(next) =>
            setFormData((s) => ({ ...s, ...next }))
          }
        />
      )}
      renderExtraBadges={({ entry }) => (
        <>
          {entry.armor_type && (
            <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold uppercase tracking-tighter">
              {entry.armor_type}
            </span>
          )}
          {entry.armor_value !== undefined && entry.armor_value !== null && (
            <span className="text-[10px] px-2 py-0.5 bg-blood/10 text-blood/80 rounded-full font-bold">
              AC {entry.armor_value}
              {entry.armor_dex !== null && entry.armor_dex !== undefined ? ` (+dex max ${entry.armor_dex})` : ''}
            </span>
          )}
          {entry.rarity && entry.rarity !== 'none' && (
            <span className="text-[10px] px-2 py-0.5 bg-gold/10 text-gold rounded-full font-bold">
              {entry.rarity}
            </span>
          )}
          {entry.stealth ? (
            <span className="text-[10px] px-2 py-0.5 bg-ink/5 text-ink/50 rounded-full font-bold uppercase tracking-tighter" title="Disadvantage on Stealth checks">
              stealth disad
            </span>
          ) : null}
        </>
      )}
    />
  );
}
