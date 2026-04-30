import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

export type SpellSummaryRecord = {
  id: string;
  name?: string;
  identifier?: string;
  sourceId?: string;
  imageUrl?: string;
  level?: number;
  school?: string;
  tagIds?: string[];
  updatedAt?: string;
  createdAt?: string;
  foundryImport?: {
    sourceBook?: string;
    sourcePage?: string;
    rules?: string;
  };
  [key: string]: any;
};

export function buildSpellSummaryPayload(spell: Record<string, any>) {
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

export async function upsertSpellSummary(spellId: string, spell: Record<string, any>) {
  await setDoc(doc(db, 'spellSummaries', spellId), buildSpellSummaryPayload(spell), { merge: true });
}

export async function deleteSpellSummary(spellId: string) {
  await deleteDoc(doc(db, 'spellSummaries', spellId));
}

export async function createSpellWithSummary(spell: Record<string, any>) {
  const created = await addDoc(collection(db, 'spells'), spell);
  await upsertSpellSummary(created.id, spell);
  return created.id;
}

export async function spellSummariesExist() {
  const snapshot = await getDocs(query(collection(db, 'spellSummaries'), orderBy('name', 'asc'), limit(1)));
  return !snapshot.empty;
}

export async function backfillSpellSummaries() {
  const spellsSnapshot = await getDocs(query(collection(db, 'spells'), orderBy('name', 'asc')));
  const docs = spellsSnapshot.docs;
  if (!docs.length) return { count: 0 };

  let count = 0;
  for (let start = 0; start < docs.length; start += 400) {
    const batch = writeBatch(db);
    const chunk = docs.slice(start, start + 400);
    for (const spellDoc of chunk) {
      batch.set(
        doc(db, 'spellSummaries', spellDoc.id),
        buildSpellSummaryPayload({ id: spellDoc.id, ...spellDoc.data() }),
        { merge: true }
      );
      count += 1;
    }
    await batch.commit();
  }

  return { count };
}
