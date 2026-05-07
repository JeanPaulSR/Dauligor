import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

const SERVICE_ACCOUNT_PATH = './firebase-service-account.json';
const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = getFirestore(admin.app(), 'ai-studio-923ef1e5-9f79-409a-94a2-971dd56e6ef0');

async function inspect(id) {
  const doc = await db.collection('subclasses').doc(id).get();
  if (doc.exists) {
    console.log(JSON.stringify(doc.data(), null, 2));
  } else {
    console.log('Doc not found');
  }
}

inspect('JFzZOPxyJVN2mJz8WaSV').then(() => process.exit(0));
