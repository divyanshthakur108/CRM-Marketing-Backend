const fs = require('fs');
const path = require('path');

const s = require('../../storage/mock_ai_gen/state.json');
const thumbsDir = path.resolve(__dirname, '../../storage/mock_ai_gen/scratch/current_thumbs');

console.log('Video list mapping:');
s.sourceVideos.forEach((v, i) => {
  console.log(`Index ${i}: assetId=${v.assetId}, original=${v.originalName}, dur=${v.durationSeconds}s`);
});
