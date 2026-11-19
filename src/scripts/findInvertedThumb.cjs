const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const dir = path.resolve(__dirname, '../../storage/mock_ai_gen/scratch/current_thumbs');
const files = fs.readdirSync(dir);

async function inspectThumbs() {
  for (const f of files) {
    const full = path.join(dir, f);
    const meta = await sharp(full).metadata();
    // Compute top-half luminance vs bottom-half luminance
    const { data, info } = await sharp(full).raw().toBuffer({ resolveWithObject: true });
    let topSum = 0;
    let bottomSum = 0;
    const halfH = Math.floor(info.height / 2);
    const rowBytes = info.width * info.channels;
    
    for (let y = 0; y < halfH; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * rowBytes + x * info.channels;
        topSum += 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      }
    }
    for (let y = halfH; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const idx = y * rowBytes + x * info.channels;
        bottomSum += 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      }
    }
    const topAvg = topSum / (halfH * info.width);
    const botAvg = bottomSum / ((info.height - halfH) * info.width);
    const ratio = topAvg / (botAvg + 0.001);
    console.log(`${f} -> ${info.width}x${info.height}, topAvg=${topAvg.toFixed(1)}, botAvg=${botAvg.toFixed(1)}, ratio=${ratio.toFixed(2)}`);
  }
}

inspectThumbs();
