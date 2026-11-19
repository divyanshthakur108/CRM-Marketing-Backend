const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function findVideos(dir) {
  let list = [];
  try {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory() && f.name !== 'node_modules' && !f.name.startsWith('.')) {
        list = list.concat(findVideos(full));
      } else if (f.isFile() && /\.(mp4|mov|m4v|webm)$/i.test(f.name)) {
        list.push(full);
      }
    }
  } catch (e) {}
  return list;
}

const allVideos = findVideos(path.resolve(__dirname, '../../storage'));
console.log('Total videos found in storage:', allVideos.length);

const nonZeroRotations = [];

for (const v of allVideos) {
  try {
    const raw = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,width,height:stream_side_data:stream_tags=rotate',
      '-of', 'json',
      v
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
    if (rot !== 0) {
      nonZeroRotations.push({ path: v, rot, w: vStream.width, h: vStream.height });
    }
  } catch (e) {}
}

console.log('Videos with non-zero rotation:', nonZeroRotations.length);
if (nonZeroRotations.length > 0) {
  console.log(nonZeroRotations);
}
