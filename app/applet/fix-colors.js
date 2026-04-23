const fs = require('fs');
const files = [
  'src/components/compendium/ActivityEditor.tsx',
  'src/pages/compendium/ClassEditor.tsx',
  'src/pages/compendium/SubclassEditor.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/bg-black\/20/g, 'bg-background/20');
  content = content.replace(/bg-black\/40/g, 'bg-background/40');
  content = content.replace(/bg-black\/5/g, 'bg-background/5');
  content = content.replace(/bg-\[\#1a1a1a\]/g, 'bg-card');
  content = content.replace(/bg-\[\#111111\]/g, 'bg-background');
  fs.writeFileSync(file, content);
  console.log('Fixed', file);
}
