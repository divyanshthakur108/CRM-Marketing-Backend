const fs = require('fs');
const path = require('path');

const s = require('../../storage/mock_ai_gen/state.json');
const thumbsDir = 'C:/Users/Lenovo/.gemini/antigravity/brain/3378bf8c-45ea-45d3-b5b5-11a2864dd4f4/whatsapp_thumbs';

console.log('Inspecting all 22 uploads in state.json:');
s.sourceVideos.forEach((v, i) => {
  const thumbFile = `thumb_${i}_${v.cleanName}.jpg`;
  const thumbPath = path.join(thumbsDir, thumbFile);
  const exists = fs.existsSync(thumbPath);
  console.log(`[${i}] ${v.cleanName} | originalName: "${v.originalName}" | dur: ${v.durationSeconds}s | thumb: ${thumbFile} (exists: ${exists})`);
});
