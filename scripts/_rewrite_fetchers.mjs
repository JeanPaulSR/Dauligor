// One-shot codemod: drop the `, null` firestore-fallback argument from
// fetchCollection / fetchDocument call sites now that the parameter is gone.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  `grep -rl --include="*.ts" --include="*.tsx" -E "fetchCollection|fetchDocument" src/ api/ 2>NUL`,
  { shell: 'bash' }
).toString().trim().split('\n').filter(Boolean);

let touched = 0;
for (const f of files) {
  let src = readFileSync(f, 'utf8');
  const before = src;

  // fetchCollection<T>(name, null)            → fetchCollection<T>(name)
  // fetchCollection<T>(name, null, opts)      → fetchCollection<T>(name, opts)
  src = src.replace(
    /(fetchCollection\s*(?:<[^>]*>)?\s*\(\s*[^,)]+(?:\([^)]*\))?[^,)]*)\s*,\s*null\s*\)/g,
    '$1)'
  );
  src = src.replace(
    /(fetchCollection\s*(?:<[^>]*>)?\s*\(\s*[^,)]+(?:\([^)]*\))?[^,)]*)\s*,\s*null\s*,/g,
    '$1,'
  );

  // fetchDocument<T>(name, id, null)          → fetchDocument<T>(name, id)
  src = src.replace(
    /(fetchDocument\s*(?:<[^>]*>)?\s*\(\s*[^,)]+\s*,\s*[^,)]+)\s*,\s*null\s*\)/g,
    '$1)'
  );

  if (src !== before) {
    writeFileSync(f, src);
    touched++;
    console.log(`  rewrote ${f}`);
  }
}
console.log(`\n${touched}/${files.length} files updated.`);
