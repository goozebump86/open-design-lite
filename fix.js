const fs = require('fs');
const file = 'c:/Users/gooze/Downloads/open-design-lite/public/index.html';
let content = fs.readFileSync(file, 'utf8');

// The string contains \` which should just be `
content = content.replace(/style\.innerHTML = \\`/g, 'style.innerHTML = `');
content = content.replace(/          \\`;/g, '          `;');

// The string contains \${ which should be ${
content = content.replace(/\\`\\\$\{mins\}m \\\$\{secs\}s\\`/g, '`${mins}m ${secs}s`');

// Also chunk.split('\\n') should be chunk.split('\n')
content = content.replace(/chunk\.split\('\\\\n'\)/g, "chunk.split('\\n')");

// And the artifact match string:
content = content.replace(/<\\\\\/artifact>/g, '</artifact>');
content = content.replace(/\[\\\\s\\\\S\]/g, '[\\s\\S]');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed backslashes');
