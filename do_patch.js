const fs = require('fs');

const indexFile = 'c:/Users/gooze/Downloads/open-design-lite/public/index.html';
const patchFile = 'c:/Users/gooze/Downloads/open-design-lite/patch.js';

let indexContent = fs.readFileSync(indexFile, 'utf8');
const patchContent = fs.readFileSync(patchFile, 'utf8');

// Find the replacement string inside patch.js
const lines = patchContent.split(/\r?\n/);
let replLines = [];
let capture = false;
for (const line of lines) {
  if (line.includes('const replacement = `')) {
    capture = true;
    continue;
  }
  if (capture && line === '`;') {
    capture = false;
    break;
  }
  if (capture) {
    replLines.push(line);
  }
}
const replacementStr = replLines.join('\n');

// Find start and end in index.html using regex
const regex = /    \/\/ ============================================================\r?\n    \/\/ FILE WORKSPACE(.*?)\/\/ ============================================================\r?\n    \/\/ ENTRY VIEW/s;

if (regex.test(indexContent)) {
  indexContent = indexContent.replace(regex, replacementStr + '\n\n    // ============================================================\n    // ENTRY VIEW');
  fs.writeFileSync(indexFile, indexContent, 'utf8');
  console.log('PATCH SUCCESS');
} else {
  console.log('REGEX FAILED');
}
