const { spawnSync } = require('child_process');
const input = 'storage/mock_ai_gen/uploads/mock_asset_1795067923113_f1713ee9.mp4'; // 464x832
const out = 'storage/mock_ai_gen/scratch/test_aspect_proxy.mp4';

// For portrait: scale to height 1280 (or keep original if smaller)
// For landscape: scale to width 1280 (or keep original if smaller)
// FFmpeg filter:
const filter = "scale='if(gt(iw,ih),min(iw,1280),-2)':'if(gt(iw,ih),-2,min(ih,1280))'";
const res = spawnSync('ffmpeg', ['-y', '-ss', '1.0', '-t', '1.0', '-i', input, '-vf', filter, '-c:v', 'libx264', '-preset', 'ultrafast', out]);
console.log('Exit code:', res.status);

const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', out], { encoding: 'utf8' });
console.log('Output dimensions:', JSON.parse(probe.stdout).streams[0]);
