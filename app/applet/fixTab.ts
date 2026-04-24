import fs from 'fs';
const code = fs.readFileSync('src/pages/compendium/ClassEditor.tsx', 'utf8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('<TabsContent value="multiclass-proficiencies"'));
let end = lines.findIndex((l, i) => i > start && l.includes('</TabsContent>'));

for (let i = start; i <= end; i++) {
  lines[i] = lines[i]
    .replace(/\.\.\.proficiencies/g, '...multiclassProficiencies')
    .replace('<h2 className="label-text text-gold">Proficiencies</h2>', '<h2 className="label-text text-gold">Multiclass Proficiencies</h2>');
}

fs.writeFileSync('src/pages/compendium/ClassEditor.tsx', lines.join('\n'));
