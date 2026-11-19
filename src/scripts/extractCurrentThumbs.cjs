const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const s = require('../../storage/mock_ai_gen/state.json');
const uploads = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads');
const outDir = path.resolve(__dirname, '../../storage/mock_ai_gen/scratch/current_thumbs');
fs.mkdirSync(outDir, { recursive: true });

console.log('Extracting thumbs for all 22 videos...');
for (let i = 0; i < s.sourceVideos.length; i++) {
  const v = s.sourceVideos[i];
  const src = path.join(uploads, v.cleanName);
  const dst = path.join(outDir, `thumb_${i}_${v.cleanName}.jpg`);
  spawnSync('ffmpeg', ['-y', '-ss', '1.0', '-i', src, '-vframes', '1', '-q:v', '2', dst]);
}
console.log('Done extracting. Files in scratch/current_thumbs:', fs.readdirSync(outDir).length);
