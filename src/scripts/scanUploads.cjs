const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const uploads = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads');
const files = fs.readdirSync(uploads).filter(f => f.endsWith('.mov') || f.endsWith('.mp4'));

console.log('Total video files:', files.length);

const rotationCounts = {};
const details = [];

for (const file of files) {
  const filePath = path.join(uploads, file);
  try {
    const raw = execSync(`ffprobe -v error -show_entries stream=codec_name,width,height:stream_side_data:stream_tags=rotate -of json "${filePath}"`, { encoding: 'utf8' });
    const json = JSON.parse(raw);
    const vStream = json.streams?.find(s => s.codec_name === 'hevc' || s.codec_name === 'h264' || s.width);
    let rot = 0;
    if (vStream?.side_data_list) {
      const dm = vStream.side_data_list.find(s => s.rotation !== undefined);
      if (dm) rot = dm.rotation;
    }
    if (!rot && vStream?.tags?.rotate) {
      rot = Number(vStream.tags.rotate);
    }
    rotationCounts[rot] = (rotationCounts[rot] || 0) + 1;
    details.push({ file, rot, w: vStream?.width, h: vStream?.height, codec: vStream?.codec_name });
  } catch (e) {
    console.error('Error probing', file, e.message);
  }
}

console.log('Rotation counts:', rotationCounts);
const nonZero = details.filter(d => d.rot !== 0);
console.log('Non-zero rotations count:', nonZero.length);
console.log('Non-zero rotations sample:', nonZero.slice(0, 5));
const zeroRot = details.filter(d => d.rot === 0);
console.log('Zero rotations count:', zeroRot.length);
if (zeroRot.length > 0) {
  console.log('Zero rotations files:', zeroRot);
}
