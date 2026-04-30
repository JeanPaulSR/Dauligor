import { getAdminServices } from "../../_lib/firebase-admin.js";

export type AdminSpellPayload = Record<string, any>;

export function buildSpellSummaryPayload(spell: AdminSpellPayload) {
  return {
    name: String(spell.name ?? ''),
    identifier: String(spell.identifier ?? ''),
    sourceId: String(spell.sourceId ?? ''),
    imageUrl: String(spell.imageUrl ?? ''),
    level: Number(spell.level ?? 0),
    school: String(spell.school ?? ''),
    tagIds: Array.isArray(spell.tagIds) ? spell.tagIds : [],
    updatedAt: spell.updatedAt || '',
    createdAt: spell.createdAt || '',
    foundryImport: {
      sourceBook: String(spell.foundryImport?.sourceBook ?? ''),
      sourcePage: String(spell.foundryImport?.sourcePage ?? ''),
      rules: String(spell.foundryImport?.rules ?? '')
    }
  };
}

export async function upsertSpellWithSummary(id: string | null, spell: AdminSpellPayload) {
  const { db } = getAdminServices();
  const sanitized = { ...spell };
  Object.keys(sanitized).forEach((key) => {
    if (sanitized[key] === undefined) delete sanitized[key];
  });

  let spellId = id;
  if (spellId) {
    await db.collection("spells").doc(spellId).set(sanitized, { merge: true });
  } else {
    const created = await db.collection("spells").add(sanitized);
    spellId = created.id;
  }

  await db.collection("spellSummaries").doc(spellId).set(buildSpellSummaryPayload(sanitized), { merge: true });
  return spellId;
}
