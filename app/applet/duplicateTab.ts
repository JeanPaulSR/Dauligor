import fs from 'fs';
const code = fs.readFileSync('src/pages/compendium/ClassEditor.tsx', 'utf8');
const lines = code.split('\n');
const start = lines.findIndex(l => l.includes('<TabsContent value="proficiencies"'));
let end = lines.findIndex((l, i) => i > start && l.includes('</TabsContent>'));
const profTab = lines.slice(start, end + 1).join('\n');
const multiTab = profTab.replace(/<TabsContent value="proficiencies"/g, '<TabsContent value="multiclass-proficiencies"')
  .replace(/value="proficiencies"/g, 'value="multiclass-proficiencies"')
  .replace(/setProficiencies\(/g, 'setMulticlassProficiencies(')
  .replace(/proficiencies\./g, 'multiclassProficiencies.')
  .replace(/proficiencies,/g, 'multiclassProficiencies,')
  .replace(/proficiencies :/g, 'multiclassProficiencies :')
  .replace(/proficiencies:/g, 'multiclassProficiencies:')
  .replace(/{proficiencies}/g, '{multiclassProficiencies}')
  .replace(/proficiencies\[/g, 'multiclassProficiencies[');

const modifiedTab = multiTab.replace(
  '<h2 className="label-text text-gold">Proficiencies</h2>',
  '<h2 className="label-text text-gold">Multiclass Proficiencies</h2>'
);

const mstart = lines.findIndex(l => l.includes('<TabsContent value="multiclassing"'));
let mend = lines.findIndex((l, i) => i > mstart && l.includes('</TabsContent>'));

// Insert multiTab after mend + 1
lines.splice(mend + 1, 0, '\n          {/* Multiclass Proficiencies */}\n' + modifiedTab);
fs.writeFileSync('src/pages/compendium/ClassEditor.tsx', lines.join('\n'));
