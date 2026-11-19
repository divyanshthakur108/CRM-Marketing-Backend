const path = require('path');
const { spawnSync } = require('child_process');

const testFile = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads/mock_asset_1795064589911_2ed0aa76.mov');

const start = Date.now();
const res = spawnSync('ffmpeg', [
  '-i', testFile,
  '-vf', "scale=240:-2,select='gt(scene,0.35)',metadata=print:key=lavfi.scene_score",
  '-f', 'null',
  '-'
], { encoding: 'utf8' });

console.log(`Scene cut execution took ${Date.now() - start}ms`);
const lines = res.stderr.split('\n');
const ptsLines = lines.filter(l => l.includes('pts_time') || l.includes('scene_score'));
console.log('Sample scene cut lines:', ptsLines.slice(0, 10));
