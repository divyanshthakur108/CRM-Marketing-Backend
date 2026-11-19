import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const RUNWAY_API_KEY = process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY;

console.log('----------------------------------------------------');
console.log('RealCRM — RunwayML API Test & Diagnostic Script');
console.log('----------------------------------------------------');

if (!RUNWAY_API_KEY) {
  console.error('❌ Error: RUNWAYML_API_SECRET is missing from .env');
  process.exit(1);
}

console.log(`✅ Loaded Runway API Key: ${RUNWAY_API_KEY.slice(0, 10)}...${RUNWAY_API_KEY.slice(-6)}`);

const headers = {
  'Authorization': `Bearer ${RUNWAY_API_KEY}`,
  'X-Runway-Version': '2024-11-06',
  'Content-Type': 'application/json',
};

/**
 * 1. Test Text-to-Image Generation Task
 */
async function testTextToImage() {
  console.log('\n[1/2] Submitting Text-to-Image Task to Runway (Model: gen4_image)...');
  try {
    const payload = {
      model: 'gen4_image',
      promptText: 'Modern luxury real estate villa architectural exterior, daytime lighting, clean landscaping',
      ratio: '1360:768',
    };

    const res = await fetch('https://api.dev.runwayml.com/v1/text_to_image', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('Runway Submit Response Status:', res.status);
    console.log('Response Payload:', JSON.stringify(data, null, 2));

    if (!res.ok) {
      console.error('❌ Runway submission returned an error:', data);
      return null;
    }

    const taskId = data.id;
    console.log(`✅ Task successfully created! Task ID: ${taskId}`);
    return taskId;
  } catch (err) {
    console.error('❌ Network or execution error while calling Runway:', err.message);
    return null;
  }
}

/**
 * 2. Poll Task Status until Succeeded or Failed
 */
async function pollTask(taskId) {
  if (!taskId) return;
  console.log(`\n[2/2] Polling Task Status for ID: ${taskId} (checking every 5 seconds)...`);

  let attempts = 0;
  const maxAttempts = 24; // 2 minutes max

  while (attempts < maxAttempts) {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 5000));

    try {
      const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
        method: 'GET',
        headers,
      });

      const task = await res.json();
      console.log(`Attempt ${attempts}: Task Status = ${task.status}`);

      if (task.status === 'SUCCEEDED') {
        console.log('\n🎉 TASK SUCCEEDED!');
        console.log('Generated Output URLs:', task.output);
        return task.output;
      }

      if (task.status === 'FAILED') {
        console.error('\n❌ Task failed on Runway:', task.failure || task.failureCode || 'Unknown reason');
        return null;
      }
    } catch (err) {
      console.warn(`Warning on poll attempt ${attempts}:`, err.message);
    }
  }

  console.log('⏳ Polling timed out. Task is still processing on Runway in background.');
}

async function run() {
  const taskId = await testTextToImage();
  if (taskId) {
    await pollTask(taskId);
  }
  console.log('\n----------------------------------------------------');
  console.log('Test complete.');
}

run();

