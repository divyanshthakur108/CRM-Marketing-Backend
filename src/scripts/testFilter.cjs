const { execSync } = require('child_process');
const path = require('path');

const file = path.resolve('CRM-Marketing-Backend/storage/mock_ai_gen/uploads/mock_asset_1795064589911_2ed0aa76.mov');
console.log('Testing on:', file);

const ffprobeOut = execSync(`ffprobe -v error -show_entries format=duration,format_name,size:stream=index,codec_name,codec_type,width,height,avg_frame_rate,side_data_list:stream_tags=rotate -of json "${file}"`).toString();
console.log('FFPROBE STREAMS:');
const parsed = JSON.parse(ffprobeOut);
for (const s of parsed.streams) {
  console.log(`Stream ${s.index} (${s.codec_type}): codec=${s.codec_name}, ${s.width}x${s.height}, fps=${s.avg_frame_rate}, rotate=${s.tags?.rotate}, side_data=${JSON.stringify(s.side_data_list)}`);
}

// Test fast metrics (sample 1 frame every 30 frames for 5 seconds)
const ffmpegCmd = `ffmpeg -v info -i "${file}" -t 5 -vf "fps=2,signalstats,blurdetect" -f null -`;
try {
  const res = execSync(ffmpegCmd, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
} catch (e) {
  const stderr = e.stderr ? e.stderr.toString() : '';
  const lines = stderr.split('\n').filter(l => l.includes('Yavg') || l.includes('blur') || l.includes('lavfi'));
  console.log('FFMPEG METRICS (sample lines):', lines.slice(0, 5));
}
