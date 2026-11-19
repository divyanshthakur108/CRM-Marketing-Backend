const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.resolve(__dirname, '../../storage/mock_ai_gen/scratch/current_thumbs');
const files = fs.readdirSync(dir);

// Let's copy all 22 to a review folder in artifacts so we can check
const artDir = 'C:/Users/Lenovo/.gemini/antigravity/brain/3378bf8c-45ea-45d3-b5b5-11a2864dd4f4/whatsapp_thumbs';
fs.mkdirSync(artDir, { recursive: true });

for (const f of files) {
  fs.copyFileSync(path.join(dir, f), path.join(artDir, f));
}
console.log('Copied all 22 thumbs to artifacts/whatsapp_thumbs');
