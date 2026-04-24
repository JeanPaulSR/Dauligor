import fs from 'fs';

const code = fs.readFileSync('src/pages/compendium/ClassEditor.tsx', 'utf8');
const lines = code.split('\n');

// Find the start of the Features block
const featureStart = lines.findIndex(l => l.includes('{/* Features */}'));
// Find the end of the Features block
// It's followed by `</TabsContent>`
let featureEnd = featureStart;
let bracketCount = 0;
let started = false;

for (let i = featureStart; i < lines.length; i++) {
  if (lines[i].includes('{id && (')) {
    started = true;
    bracketCount += (lines[i].match(/{/g) || []).length;
    bracketCount -= (lines[i].match(/}/g) || []).length;
  } else if (started) {
    bracketCount += (lines[i].match(/{/g) || []).length;
    bracketCount -= (lines[i].match(/}/g) || []).length;
    if (bracketCount === 0) {
      featureEnd = i;
      break;
    }
  }
}

// Since it's currently inside `progression`, it's right before `</TabsContent>`
if (featureEnd === featureStart) {
  // alternative way: find next `</TabsContent>` and it's right above it.
  featureEnd = lines.findIndex((l, i) => i > featureStart && l.includes('</TabsContent>')) - 1;
}

const featuresBlock = lines.slice(featureStart, featureEnd + 1);

// Remove features block from its current location
lines.splice(featureStart, featureEnd - featureStart + 1);

// Now we need to insert it between equipment and multiclassing
const eqStart = lines.findIndex(l => l.includes('<TabsContent value="equipment"'));
const eqEnd = lines.findIndex((l, i) => i > eqStart && l.includes('</TabsContent>'));

// Insert after equipment TabContent
lines.splice(eqEnd + 1, 0, '\n          <TabsContent value="features" className="space-y-6 mt-0">', ...featuresBlock, '          </TabsContent>');

fs.writeFileSync('src/pages/compendium/ClassEditor.tsx', lines.join('\n'));
