const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const s = require('../../storage/mock_ai_gen/state.json');
const uploads = path.resolve(__dirname, '../../storage/mock_ai_gen/uploads');

console.log('Testing WhatsApp uploads in storage:');
for (let i = 0; i < s.sourceVideos.length; i++) {
  const v = s.sourceVideos[i];
  const filePath = path.join(uploads, v.cleanName);
  const raw = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,width,height:stream_side_data:stream_tags=rotate',
    '-of', 'json',
    filePath
  ], { encoding: 'utf8' });
  const json = JSON.parse(raw.stdout);
  const vStream = json.streams?.find(s => s.width);
  let rot = 0;
  if (vStream?.side_data_list) {
    const dm = vStream.side_data_list.find(s => s.rotation !== undefined);
    if (dm) rot = dm.rotation;
  }
  if (!rot && vStream?.tags?.rotate) {
    rot = Number(vStream.tags.rotate);
  }
  console.log(`[${i}] ${v.cleanName} (${v.originalName}) -> ${vStream?.width}x${vStream?.height}, rot=${rot}`);
}
