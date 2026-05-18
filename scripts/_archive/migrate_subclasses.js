
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WORKER_DIR = path.resolve(ROOT, 'worker');

const SERVICE_ACCOUNT_PATH = path.resolve(ROOT, 'firebase-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = getFirestore('ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

function esc(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/'/g, "''");
}

function json(value) {
  return esc(JSON.stringify(value ?? null));
}

async function migrateSubclasses() {
  const snap = await db.collection('subclasses').get();
  console.log(`Found ${snap.docs.length} subclasses in Firestore`);
  
  const statements = snap.docs.map(doc => {
    const data = doc.data();
    const id = doc.id;
    return `INSERT OR REPLACE INTO subclasses (id, class_id, name, source_id, description, image_url, image_display, spellcasting, advancements) VALUES ('${id}', '${esc(data.classId)}', '${esc(data.name)}', ${data.sourceId ? `'${esc(data.sourceId)}'` : 'NULL'}, '${esc(data.description || '')}', '${esc(data.imageUrl || '')}', '${json(data.imageDisplay)}', '${json(data.spellcasting || {})}', '${json(data.advancements || [])}');`;
  });

  const sqlFile = path.resolve(ROOT, '.migrate_subclasses_test.sql');
  fs.writeFileSync(sqlFile, statements.join('\n'));
  
  try {
    console.log('Executing SQL...');
    execSync(`npx wrangler d1 execute dauligor-db --local --file="${sqlFile}"`, { cwd: WORKER_DIR, stdio: 'inherit' });
    console.log('Done!');
  } catch (err) {
    console.error('Execution failed:', err.message);
  }
}

migrateSubclasses().catch(console.error);
