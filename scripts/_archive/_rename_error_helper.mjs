// Codemod: rename handleFirestoreError → reportClientError in all consumers
// after the Firestore migration. Pairs with src/lib/firebase.ts, which keeps
// `handleFirestoreError` as a deprecated alias until this codemod lands.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  `grep -rl --include="*.ts" --include="*.tsx" "handleFirestoreError" src/ 2>NUL`,
  { shell: 'bash' }
).toString().trim().split('\n').filter(Boolean);

let touched = 0;
for (const f of files) {
  if (f.endsWith('lib/firebase.ts')) continue; // keep the export alias here for one more round
  let src = readFileSync(f, 'utf8');
  const before = src;
  // Word-boundary replace handles imports + call sites uniformly.
  src = src.replace(/\bhandleFirestoreError\b/g, 'reportClientError');
  if (src !== before) {
    writeFileSync(f, src);
    touched++;
    console.log(`  rewrote ${f}`);
  }
}
console.log(`\n${touched}/${files.length} files renamed.`);
