const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dir = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads');
const outDir = 'C:/Users/Lenovo/.gemini/antigravity/brain/3378bf8c-45ea-45d3-b5b5-11a2864dd4f4/all_video_thumbs';

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4'));
console.log(`Found ${files.length} mp4 files.`);

for (const f of files) {
  const input = path.join(dir, f);
  const out = path.join(outDir, f.replace('.mp4', '.jpg'));
  try {
    execSync(`ffmpeg -y -ss 00:00:01 -i "${input}" -vframes 1 -q:v 2 "${out}"`, { stdio: 'ignore' });
    console.log(`Done: ${f}`);
  } catch (err) {
    console.error(`Failed: ${f}`, err.message);
  }
}

console.log('ALL THUMBS EXTRACTED');
