const s = require('../../storage/mock_ai_gen/state.json');
console.log('Total videos in state:', s.sourceVideos.length);
s.sourceVideos.forEach((v, i) => {
  console.log(`${i}: ${v.assetId} | ${v.originalName} | ${v.cleanName} | dur=${v.durationSeconds}s | ${v.width}x${v.height}`);
});
