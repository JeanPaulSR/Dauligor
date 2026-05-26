import { Hammer } from 'lucide-react';
import ProficiencyEntityShell from '../../components/compendium/ProficiencyEntityShell';
import ToolMechanicsFields, {
  TOOL_MECHANICS_DEFAULTS,
  type ToolMechanicsState,
} from '../../components/compendium/ToolMechanicsFields';

/**
 * Tool editor — admin surface for the `tools` table. As of migration
 * 20260524-1800 the form covers Foundry's tool shape:
 *   - system.type.value (art/game/music/vehicle)
 *   - system.type.baseItem (SRD ref like 'alchemist', 'lute')
 *   - system.bonus (flat bonus added to tool checks)
 *   - Plus shared item shell: weight, price, rarity, attunement
 *   - system.ability is already tracked via the existing ability_id FK
 */

type ToolExtras = ToolMechanicsState;

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

export default function ToolsEditor({
  userProfile,
  hideHeader,
}: {
  userProfile: any;
  hideHeader?: boolean;
}) {
  return (
    <ProficiencyEntityShell<ToolExtras>
      userProfile={userProfile}
      table="tools"
      singular="Tool"
      plural="Tools"
      icon={Hammer}
      description="Define the tools and instruments available in your game system."
      hideHeader={hideHeader}
      backLink={{ href: '/compendium/classes', label: 'Back to Classes' }}
      categoryFK={{
        column: 'category_id',
        referenceTable: 'toolCategories',
        label: 'Category',
      }}
      extraDefaults={TOOL_MECHANICS_DEFAULTS}
      hydrateExtras={(entry) => ({
        toolType: entry.tool_type ?? 'art',
        baseItem: entry.base_item ?? '',
        bonus: entry.bonus ?? '',
        weight: readJsonObj(entry.weight, TOOL_MECHANICS_DEFAULTS.weight),
        price: readJsonObj(entry.price, TOOL_MECHANICS_DEFAULTS.price),
        rarity: entry.rarity ?? 'none',
        attunement: entry.attunement ?? '',
      })}
      buildExtraPayload={(form) => ({
        tool_type: form.toolType,
        base_item: form.baseItem || null,
        bonus: form.bonus || null,
        weight: form.weight,
        price: form.price,
        rarity: form.rarity,
        attunement: form.attunement || null,
      })}
      renderExtraFields={({ formData, setFormData }) => (
        <ToolMechanicsFields
          state={formData}
          onChange={(next) =>
            setFormData((s) => ({ ...s, ...next }))
          }
        />
      )}
      renderExtraBadges={({ entry }) => (
        <>
          {entry.tool_type && (
            <span className="text-[10px] px-2 py-0.5 bg-ink/10 text-ink/70 rounded-full font-bold uppercase tracking-tighter">
              {entry.tool_type}
            </span>
          )}
          {entry.rarity && entry.rarity !== 'none' && (
            <span className="text-[10px] px-2 py-0.5 bg-gold/10 text-gold rounded-full font-bold">
              {entry.rarity}
            </span>
          )}
        </>
      )}
    />
  );
}
