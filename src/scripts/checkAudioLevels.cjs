const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const s = require('../../storage/mock_ai_gen/state.json');
const uploads = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads');

console.log('Checking audio loudness and speech presence on all 22 uploads:');
for (let i = 0; i < s.sourceVideos.length; i++) {
  const v = s.sourceVideos[i];
  const filePath = path.join(uploads, v.cleanName);
  const res = spawnSync('ffmpeg', [
    '-i', filePath,
    '-af', 'volumedetect',
    '-f', 'null',
    '-'
  ], { encoding: 'utf8' });
  const stderr = res.stderr || '';
  const maxVol = stderr.match(/max_volume:\s+([-\d.]+)\s+dB/);
  const meanVol = stderr.match(/mean_volume:\s+([-\d.]+)\s+dB/);
  console.log(`[${i}] ${v.cleanName} (${v.originalName.slice(0, 30)}) -> max: ${maxVol ? maxVol[1] : 'none'} dB, mean: ${meanVol ? meanVol[1] : 'none'} dB`);
}
