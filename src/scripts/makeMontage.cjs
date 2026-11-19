const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function makeMontage() {
  const thumbDir = 'C:/Users/Lenovo/.gemini/antigravity/brain/3378bf8c-45ea-45d3-b5b5-11a2864dd4f4/all_video_thumbs';
  const outPath = 'C:/Users/Lenovo/.gemini/antigravity/brain/3378bf8c-45ea-45d3-b5b5-11a2864dd4f4/all_videos_contact_sheet.jpg';

  const files = fs.readdirSync(thumbDir).filter(f => f.endsWith('.jpg'));
  const cols = 5;
  const rows = Math.ceil(files.length / cols);
  const cellW = 240;
  const cellH = 426;

  const canvas = sharp({
    create: {
      width: cols * cellW,
      height: rows * cellH,
      channels: 3,
      background: { r: 18, g: 24, b: 38 }
    }
  });

  const composites = [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = col * cellW;
    const top = row * cellH;

    const shortId = f.replace('mock_asset_', '').replace('.jpg', '');
    const resized = await sharp(path.join(thumbDir, f))
      .resize(cellW - 8, cellH - 40, { fit: 'cover' })
      .toBuffer();

    const labelSvg = Buffer.from(`
      <svg width="${cellW}" height="32">
        <rect x="0" y="0" width="${cellW}" height="32" fill="#0b0f17" />
        <text x="6" y="20" font-family="Arial" font-size="12" font-weight="bold" fill="#38BDF8">${shortId.slice(-12)}</text>
      </svg>
    `);

    composites.push({
      input: resized,
      left: left + 4,
      top: top + 4
    });

    composites.push({
      input: labelSvg,
      left: left,
      top: top + cellH - 34
    });
  }

  await canvas.composite(composites).jpeg({ quality: 85 }).toFile(outPath);
  console.log('Contact sheet saved to:', outPath);
}

makeMontage().catch(console.error);
