
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SERVICE_ACCOUNT_PATH = path.resolve(ROOT, 'firebase-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore('ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

async function count() {
  const collections = ['classes', 'subclasses', 'features', 'scalingColumns', 'spellcastingScalings'];
  for (const name of collections) {
    const snap = await db.collection(name).get();
    console.log(`${name}: ${snap.docs.length} documents`);
    if (snap.docs.length > 0 && name === 'subclasses') {
        console.log('Sample subclass:', snap.docs[0].id, snap.docs[0].data().name);
    }
  }
}

count().catch(console.error);
