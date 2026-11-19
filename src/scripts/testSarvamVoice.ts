import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { SarvamAIClient } from 'sarvamai';

// Load .env
dotenv.config();

const SAMPLE_TEXT =
  'क्या आप एक ऐसा घर ढूंढ रहे हैं, जहाँ हर corner में comfort और elegance हो? आइए, देखते हैं इसकी खूबसूरत details.';

const OUTPUT_DIR = path.resolve(process.cwd(), 'storage', 'mock_ai_gen', 'audio');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'sarvam_voice_test.wav');

async function runSarvamVoiceTest() {
  const apiKey = process.env.SARVAM_API_KEY?.trim();

  if (!apiKey) {
    console.error('❌ Error: SARVAM_API_KEY is not defined in .env.');
    console.error('Please add SARVAM_API_KEY=<your_sarvam_api_key> to CRM-Marketing-Backend/.env');
    process.exit(1);
  }

  console.log('--- Sarvam AI TTS Single-Shot Voice Test ---');
  console.log(`Model: bulbul:v4-flash`);
  console.log(`Speaker: shubh_enhi_ads`);
  console.log(`Language: hi-IN (Hindi/Hinglish)`);
  console.log(`Codec: wav`);
  console.log(`Sample Text (${SAMPLE_TEXT.length} chars): "${SAMPLE_TEXT}"`);

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const client = new SarvamAIClient({
    apiSubscriptionKey: apiKey,
  });

  console.log('\n[1/3] Sending request to Sarvam Text-to-Speech API...');
  const startTime = Date.now();

  try {
    const response = await client.textToSpeech.convert({
      text: SAMPLE_TEXT,
      language_code: 'hi-IN',
      model: 'bulbul:v4-flash',
      speaker: 'shubh_enhi_ads',
      output_audio_codec: 'wav',
    });

    const elapsedMs = Date.now() - startTime;
    console.log(`[2/3] Response received in ${elapsedMs}ms!`);
    console.log(`Provider Request ID: ${response.request_id || 'N/A'}`);

    if (!response.audios || response.audios.length === 0) {
      throw new Error('Sarvam API returned an empty audio array.');
    }

    const base64Audio = response.audios[0];
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    fs.writeFileSync(OUTPUT_FILE, audioBuffer);
    console.log(`[3/3] Audio decoded and saved (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(`Output Location: ${OUTPUT_FILE}`);

    // Determine audio duration using ffprobe if available
    let durationStr = 'Unknown';
    try {
      const ffprobeCmd = `ffprobe -i "${OUTPUT_FILE}" -show_entries format=duration -v quiet -of csv="p=0"`;
      const durationSec = parseFloat(execSync(ffprobeCmd, { encoding: 'utf8' }).trim());
      if (!isNaN(durationSec)) {
        durationStr = `${durationSec.toFixed(2)} seconds`;
      }
    } catch {
      // Fallback: estimate from PCM WAV header (sample rate * channels * bytes/sample)
      if (audioBuffer.length > 44) {
        const sampleRate = audioBuffer.readUInt32LE(24);
        const byteRate = audioBuffer.readUInt32LE(28);
        if (byteRate > 0) {
          const dataSize = audioBuffer.length - 44;
          const sec = dataSize / byteRate;
          durationStr = `~${sec.toFixed(2)} seconds (${sampleRate} Hz)`;
        }
      }
    }

    console.log(`\n========================================`);
    console.log(`✅ Sarvam AI TTS Test Completed Successfully!`);
    console.log(`- Request ID: ${response.request_id || 'N/A'}`);
    console.log(`- Audio Duration: ${durationStr}`);
    console.log(`- File Saved: ${OUTPUT_FILE}`);
    console.log(`========================================`);
  } catch (err: unknown) {
    console.error('❌ Sarvam TTS Request Failed:');
    if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }
}

// Execute
runSarvamVoiceTest();
