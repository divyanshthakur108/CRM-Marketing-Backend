const s = require('../../storage/mock_ai_gen/state.json');
console.log('Keys:', Object.keys(s));
for (const k of Object.keys(s)) {
  const v = s[k];
  console.log(`Key ${k}: type=${typeof v}, isArray=${Array.isArray(v)}, len=${Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v || {}).length : v}`);
}
