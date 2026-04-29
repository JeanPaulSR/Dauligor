import React from "react";
import ReferenceSheetDialog from "./ReferenceSheetDialog";
import {
  normalizeAbilityKey,
  slugifyReferenceSegment,
  type ReferenceColumnExample,
} from "../../lib/referenceSyntax";

function getModifier(score: number) {
  return Math.floor((Number(score) - 10) / 2);
}

export default function CharacterReferencePanel({
  character,
  classIdentifier,
  classLabel,
  subclassIdentifier,
  subclassLabel,
  spellcastingAbility,
  classColumns = [],
}: {
  character: any;
  classIdentifier?: string;
  classLabel?: string;
  subclassIdentifier?: string;
  subclassLabel?: string;
  spellcastingAbility?: string;
  classColumns?: ReferenceColumnExample[];
}) {
  const abilityKey = normalizeAbilityKey(spellcastingAbility || "int");
  const abilityScore = Number(
    character?.stats?.base?.[abilityKey.toUpperCase()] ??
      character?.stats?.base?.[abilityKey] ??
      10,
  );
  const abilityMod = getModifier(abilityScore);
  const proficiencyBonus = Number(character?.proficiencyBonus || 2);
  const totalLevel = Number(character?.level || 1);
  const hpCurrent = Number(character?.hp?.current || 0);
  const nativeClassIdentifier = slugifyReferenceSegment(classIdentifier);
  const nativeSubclassIdentifier = slugifyReferenceSegment(subclassIdentifier);

  const summaryRows = [
    { label: "Prof", value: `+${proficiencyBonus}` },
    { label: "Level", value: totalLevel },
    { label: `${abilityKey.toUpperCase()} Mod`, value: abilityMod >= 0 ? `+${abilityMod}` : String(abilityMod) },
    { label: "HP", value: hpCurrent },
  ];

  return (
    <div className="rounded-lg border border-gold/20 bg-card/50 shadow-sm overflow-hidden">
      <div className="section-header px-4 py-3 border-b border-gold/10 bg-gold/5">
        <div>
          <h3 className="label-text text-gold">Reference Surface</h3>
          <p className="field-hint mt-1 max-w-2xl">
            Keep the sheet focused and open the full reference window only when you need
            the Foundry paths, semantic syntax, or class-column rules.
          </p>
        </div>
        <ReferenceSheetDialog
          title="Character Reference Sheet"
          triggerLabel="Open Reference Sheet"
          triggerIcon="scroll"
          context={{
            classIdentifier: nativeClassIdentifier,
            classLabel,
            subclassIdentifier: nativeSubclassIdentifier,
            subclassLabel,
            spellcastingAbility: abilityKey,
            classColumns,
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        {summaryRows.map((row) => (
          <div key={row.label} className="rounded-md border border-gold/10 bg-background/40 p-3">
            <p className="label-text text-ink/45">{row.label}</p>
            <p className="mt-1 text-xl font-serif font-black text-ink">{row.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
