import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { SarvamAIClient } from 'sarvamai';
import { logger } from '../../config/logger.js';
import { runFfmpeg, resolveFfmpegBinary, resolveFfprobeBinary } from '../../utils/ffmpeg.js';
import { MockCampaign, MockPropertyProject } from './mockPropertySchema.js';

const execFileAsync = promisify(execFile);

export interface SceneNarrationItem {
  sceneIndex: number;
  sceneRole: string;
  sceneDuration: number;
  startSeconds: number;
  endSeconds: number;
  narrationText: string;
  captionText: string;
  highlightWords: string[];
  language: 'en' | 'hi' | 'hinglish';
  audioClipPath?: string;
  audioDurationSeconds?: number;
}

export interface NarrationScript {
  campaignId: string;
  campaignName: string;
  designProfile: string;
  totalDurationSeconds: number;
  language: string;
  voiceTone: string;
  scenes: SceneNarrationItem[];
  generatedAt: string;
}

export interface CaptionCueWord {
  word: string;
  startSeconds: number;
  endSeconds: number;
  isEmphasis: boolean;
}

export interface CaptionCueItem {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  highlightWords: string[];
  words: CaptionCueWord[];
  assLine: string;
}

export interface CaptionsTimeline {
  campaignId: string;
  designProfile: string;
  totalDurationSeconds: number;
  safeZoneMarginV: number;
  cues: CaptionCueItem[];
  generatedAt: string;
}

export class MockVoiceoverService {
  private baseDir: string;
  private audioDir: string;
  private cacheDir: string;

  constructor() {
    this.baseDir = path.resolve(process.cwd(), 'storage', 'mock_ai_gen');
    if (!fs.existsSync(this.baseDir)) {
      this.baseDir = path.resolve(process.cwd(), 'CRM-Marketing-Backend', 'storage', 'mock_ai_gen');
    }
    this.audioDir = path.join(this.baseDir, 'audio');
    this.cacheDir = path.join(this.audioDir, 'cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generates a contextually accurate narration script and caption schedule
   * based on verified property JSON facts and campaign storyboard.
   */
  public generateScriptAndTimeline(
    campaign: MockCampaign,
    project: MockPropertyProject
  ): { script: NarrationScript; timeline: CaptionsTimeline } {
    const isHindi = campaign.language?.toLowerCase().includes('hindi') && !campaign.language?.toLowerCase().includes('hinglish');
    const langKey: 'en' | 'hi' | 'hinglish' = isHindi ? 'hi' : 'hinglish';

    const pName = project.project?.name || 'Updated Luxury Flat Demo';
    const bhk = project.project?.configuration?.bhk || 3;
    const carpet = project.project?.area?.carpetSqFt || 1170;
    const city = project.project?.address?.city || 'Gurugram';

    const scenes: SceneNarrationItem[] = [];
    const cues: CaptionCueItem[] = [];

    let currentStart = 0;

    for (let i = 0; i < campaign.scenes.length; i++) {
      const sc = campaign.scenes[i];
      const dur = sc.seconds;
      const end = currentStart + dur;

      let narrationText = '';
      let captionText = sc.text;
      let highlightWords: string[] = [];

      const extractedHighlights = (sc.text.match(/\*([^*]+)\*/g) || []).map((w) => w.replace(/\*/g, ''));
      const roleOrAsset = (sc.role + ' ' + (sc.assetId || '')).toLowerCase();

      if (langKey === 'hi') {
        // Modern Architectural Profile — Pure, clean Hindi
        if (roleOrAsset.includes('hook') || roleOrAsset.includes('rapid_opening')) {
          narrationText = 'एक ऐसा घर, जो आपकी पहचान और सोच को नई ऊँचाई दे।';
          captionText = 'एक ऐसा घर, जो आपकी *पहचान* बन जाए।';
          highlightWords = ['पहचान'];
        } else if (roleOrAsset.includes('property_intro') || roleOrAsset.includes('property_introduction') || roleOrAsset.includes('intro') || roleOrAsset.includes('living_wide')) {
          narrationText = `${pName} में आपका स्वागत है। ${bhk} बीएचके अल्ट्रा लक्ज़री फ्लोर्स।`;
          captionText = `वेलकम टू *${pName}* — ${bhk} BHK।`;
          highlightWords = [pName, `${bhk} BHK`];
        } else if (roleOrAsset.includes('reveal') || roleOrAsset.includes('hero') || roleOrAsset.includes('materials') || roleOrAsset.includes('living')) {
          narrationText = `${carpet} स्क्वेयर फीट का स्पेशियस कार्पेट एरिया, जहाँ हर कोना खास है।`;
          captionText = `${carpet} sq.ft का शानदार *लक्ज़री कार्पेट* एरिया।`;
          highlightWords = ['लक्ज़री कार्पेट'];
        } else if (roleOrAsset.includes('map') || roleOrAsset.includes('location')) {
          narrationText = `एक्सप्रेसवे से सिर्फ 5 मिनट, और मेट्रो स्टेशन से 12 मिनट की दूरी।`;
          captionText = `कनेक्टेड टू *एवरीथिंग दैट मैटर्स*।`;
          highlightWords = ['एवरीथिंग दैट मैटर्स'];
        } else if (roleOrAsset.includes('kitchen') || roleOrAsset.includes('dining') || roleOrAsset.includes('amenit') || roleOrAsset.includes('feature')) {
          narrationText = `जर्मन फिटिंग्स और प्रीमियम फिनिश के साथ मॉड्यूलर किचन।`;
          captionText = `मॉडर्न किचन, विथ *जर्मन प्रेसिशन*।`;
          highlightWords = ['जर्मन प्रेसिशन'];
        } else if (roleOrAsset.includes('master') || roleOrAsset.includes('suite') || roleOrAsset.includes('bed') || roleOrAsset.includes('flexibility') || roleOrAsset.includes('detail') || roleOrAsset.includes('bath')) {
          narrationText = `सुकून, प्राइवेसी और भरपूर धूप से सराबोर आपका मास्टर बेडरूम।`;
          captionText = `योर पर्सनल रिट्रीट ऑफ *क्वाइट एलिगेंस*।`;
          highlightWords = ['क्वाइट एलिगेंस'];
        } else if (roleOrAsset.includes('terrace') || roleOrAsset.includes('rooftop') || roleOrAsset.includes('balcony') || roleOrAsset.includes('breathing') || roleOrAsset.includes('specs') || roleOrAsset.includes('value')) {
          narrationText = `शाम की चाय और सुंदर नज़ारों के लिए खूबसूरत कम्युनिटी रूफटॉप टेरेस।`;
          captionText = `पैनोरमिक व्यूज फ्रॉम *स्काईलाइन टेरेस*।`;
          highlightWords = ['स्काईलाइन टेरेस'];
        } else {
          narrationText = `रेरा अप्रूव्ड। रियल सीआरएम के साथ आज ही अपना एक्सक्लूसिव वॉकथ्रू बुक करें।`;
          captionText = `बुक योर प्राइवेट कंसल्टेशन *टुडे*।`;
          highlightWords = ['टुडे'];
        }
      } else {
        // Luxury Editorial / Presenter-Led — Polished, Conversational Hinglish
        if (roleOrAsset.includes('hook') || roleOrAsset.includes('rapid_opening')) {
          narrationText = 'क्या आप ढूंढ रहे हैं एक truly premium 3 BHK home? आइए, देखते हैं इसकी खूबसूरत details.';
          captionText = 'Looking for a *truly premium* 3 BHK home?';
          highlightWords = ['truly premium'];
        } else if (roleOrAsset.includes('property_intro') || roleOrAsset.includes('property_introduction') || roleOrAsset.includes('intro') || roleOrAsset.includes('living_wide')) {
          narrationText = `${pName} में आपका स्वागत है। Modern ${bhk} BHK luxury prime ${city} में।`;
          captionText = `Welcome to *${pName}* — ${bhk} BHK`;
          highlightWords = [pName, `${bhk} BHK`];
        } else if (roleOrAsset.includes('reveal') || roleOrAsset.includes('hero') || roleOrAsset.includes('materials') || roleOrAsset.includes('living')) {
          narrationText = `यह ${carpet} sq.ft carpet living space, बना है purely comfort और elegance के लिए।`;
          captionText = `${carpet} sq.ft carpet space, crafted for *comfort & elegance*`;
          highlightWords = ['comfort & elegance'];
        } else if (roleOrAsset.includes('map') || roleOrAsset.includes('location')) {
          narrationText = 'एक prime location, जो आपको expressway और शहर के हर major hub से जोड़े रखती है।';
          captionText = 'Prime connectivity that keeps you *ahead*';
          highlightWords = ['ahead'];
        } else if (roleOrAsset.includes('kitchen') || roleOrAsset.includes('dining') || roleOrAsset.includes('amenit') || roleOrAsset.includes('feature')) {
          narrationText = 'Precision-crafted modular kitchen, जहाँ हर corner में है thoughtful design.';
          captionText = 'Kitchen crafted with *precision* & style';
          highlightWords = ['precision'];
        } else if (roleOrAsset.includes('master') || roleOrAsset.includes('suite') || roleOrAsset.includes('bed') || roleOrAsset.includes('flexibility') || roleOrAsset.includes('detail') || roleOrAsset.includes('bath')) {
          narrationText = 'आपका master bedroom retreat — शांति, natural light और understated luxury का संगम।';
          captionText = 'Master retreat of *calm & natural light*';
          highlightWords = ['calm & natural light'];
        } else if (roleOrAsset.includes('terrace') || roleOrAsset.includes('rooftop') || roleOrAsset.includes('balcony') || roleOrAsset.includes('breathing') || roleOrAsset.includes('specs') || roleOrAsset.includes('value')) {
          narrationText = 'शाम की ताज़ा हवा और panoramic views के लिए expansive community rooftop.';
          captionText = 'Panoramic skyline views from *community rooftop*';
          highlightWords = ['community rooftop'];
        } else {
          narrationText = `RERA registered. आज ही अपना exclusive walkthrough schedule करें।`;
          captionText = 'Schedule your *private walkthrough* today';
          highlightWords = ['private walkthrough'];
        }
      }

      if (extractedHighlights.length > 0) {
        highlightWords = Array.from(new Set([...highlightWords, ...extractedHighlights]));
      }

      scenes.push({
        sceneIndex: i,
        sceneRole: sc.role,
        sceneDuration: dur,
        startSeconds: currentStart,
        endSeconds: end,
        narrationText,
        captionText,
        highlightWords,
        language: langKey,
      });

      // Break caption into word-by-word timestamps for animated reveal
      const cleanWords = captionText.replace(/\*/g, '').split(/\s+/).filter(Boolean);
      const wordDuration = (dur * 0.75) / Math.max(1, cleanWords.length);
      const wordsWithTiming: CaptionCueWord[] = cleanWords.map((w, wIdx) => {
        const wStart = currentStart + 0.3 + wIdx * wordDuration;
        const wEnd = wStart + wordDuration;
        const isEmp = highlightWords.some((hw) => w.toLowerCase().includes(hw.toLowerCase()) || hw.toLowerCase().includes(w.toLowerCase()));
        return {
          word: w,
          startSeconds: Number(wStart.toFixed(2)),
          endSeconds: Number(wEnd.toFixed(2)),
          isEmphasis: isEmp,
        };
      });

      // Generate stylized ASS line with subtle fade and champagne gold highlights
      const assCleanText = this.formatAssDialogueText(captionText, highlightWords);
      cues.push({
        index: i,
        startSeconds: Number((currentStart + 0.25).toFixed(2)),
        endSeconds: Number((end - 0.25).toFixed(2)),
        text: captionText,
        highlightWords,
        words: wordsWithTiming,
        assLine: `Dialogue: 0,${this.formatAssTime(currentStart + 0.25)},${this.formatAssTime(end - 0.25)},LuxuryCaption,,0,0,420,,{\\fad(220,200)}${assCleanText}`,
      });

      currentStart = end;
    }

    const script: NarrationScript = {
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      designProfile: campaign.designProfile,
      totalDurationSeconds: currentStart,
      language: campaign.language,
      voiceTone: 'Warm, polished, confident real-estate editorial',
      scenes,
      generatedAt: new Date().toISOString(),
    };

    const timeline: CaptionsTimeline = {
      campaignId: campaign.id,
      designProfile: campaign.designProfile,
      totalDurationSeconds: currentStart,
      safeZoneMarginV: 420, // Y=1500px on 1080x1920 (safe from 380px bottom controls)
      cues,
      generatedAt: new Date().toISOString(),
    };

    return { script, timeline };
  }

  /**
   * Synthesizes the complete synchronized voiceover audio track.
   * Prioritizes Sarvam AI Bulbul V4 Flash with intelligent disk caching.
   * Gracefully falls back to Windows native SAPI if offline or unconfigured.
   */
  public async synthesizeVoiceoverTrack(
    script: NarrationScript,
    outputWavPath: string,
    options?: { uploadedVoicePath?: string; speaker?: string }
  ): Promise<{ audioPath: string; durationSeconds: number; wasUploaded: boolean; provider: string }> {
    if (options?.uploadedVoicePath && fs.existsSync(options.uploadedVoicePath)) {
      logger.info({ path: options.uploadedVoicePath }, 'Using uploaded human voice audio track');
      await fsPromises.copyFile(options.uploadedVoicePath, outputWavPath);
      const duration = await this.probeAudioDuration(outputWavPath);
      return { audioPath: outputWavPath, durationSeconds: duration, wasUploaded: true, provider: 'uploaded_human' };
    }

    const tempDir = path.join(path.dirname(outputWavPath), `tmp_tts_${Date.now()}`);
    await fsPromises.mkdir(tempDir, { recursive: true });

    const sarvamKey = process.env.SARVAM_API_KEY?.trim();
    const speaker = options?.speaker || 'shubh_enhi_ads';
    const batchItems: Array<{ index: number; text: string; outFile: string; startMs: number }> = [];

    for (const scene of script.scenes) {
      const clipPath = path.join(tempDir, `vo_scene_${scene.sceneIndex}.wav`);
      batchItems.push({
        index: scene.sceneIndex,
        text: scene.narrationText,
        outFile: clipPath,
        startMs: Math.round(scene.startSeconds * 1000 + 350), // 350ms lead-in
      });
    }

    let providerUsed = 'sapi';

    if (sarvamKey) {
      try {
        logger.info({ speaker, count: batchItems.length }, 'Synthesizing voiceover with Sarvam AI Bulbul V4 Flash...');
        const sarvamClient = new SarvamAIClient({ apiSubscriptionKey: sarvamKey });

        for (const item of batchItems) {
          const cacheKey = crypto.createHash('md5').update(`${item.text}_bulbul:v4-flash_${speaker}_hi-IN`).digest('hex');
          const cachedPath = path.join(this.cacheDir, `${cacheKey}.wav`);

          if (fs.existsSync(cachedPath)) {
            logger.info({ index: item.index, cacheKey }, 'Reusing cached Sarvam voice clip');
            await fsPromises.copyFile(cachedPath, item.outFile);
          } else {
            logger.info({ index: item.index, text: item.text }, 'Requesting Sarvam Bulbul V4 TTS clip...');
            const response = await sarvamClient.textToSpeech.convert({
              text: item.text,
              model: 'bulbul:v4-flash',
              speaker: speaker as any,
              language_code: 'hi-IN',
              output_audio_codec: 'wav',
            });

            if (!response.audios || response.audios.length === 0) {
              throw new Error(`Empty audio returned for scene ${item.index}`);
            }

            const buf = Buffer.from(response.audios[0], 'base64');
            await fsPromises.writeFile(cachedPath, buf);
            await fsPromises.writeFile(item.outFile, buf);
          }
        }
        providerUsed = 'sarvam_bulbul_v4';
      } catch (sarvamErr: unknown) {
        logger.warn({ err: sarvamErr }, 'Sarvam AI synthesis failed, falling back to offline SAPI speech engine');
        providerUsed = 'sapi_fallback';
      }
    }

    if (providerUsed !== 'sarvam_bulbul_v4') {
      // Offline Windows SAPI Fallback
      const batchJsonPath = path.join(tempDir, 'tts_batch.json');
      await fsPromises.writeFile(batchJsonPath, JSON.stringify(batchItems, null, 2), 'utf8');

      const psScriptPath = path.join(tempDir, 'run_sapi.ps1');
      const psScript = `
        param([string]$jsonPath)
        $items = Get-Content $jsonPath -Raw | ConvertFrom-Json
        $voice = New-Object -ComObject SAPI.SpVoice
        $voice.Rate = -1
        $voice.Volume = 100
        foreach ($item in $items) {
            $stream = New-Object -ComObject SAPI.SpFileStream
            $stream.Open($item.outFile, 3, $false)
            $voice.AudioOutputStream = $stream
            $voice.Speak($item.text)
            $stream.Close()
        }
      `;
      await fsPromises.writeFile(psScriptPath, psScript, 'utf8');

      execSync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}" -jsonPath "${batchJsonPath}"`, {
        timeout: 25000,
        stdio: 'pipe',
      });
    }

    // Assemble all clips with exact timeline delay offsets into single master track
    const ffmpegArgs: string[] = ['-y'];
    const filterSegments: string[] = [];
    const amixInputs: string[] = [];

    for (let i = 0; i < batchItems.length; i++) {
      ffmpegArgs.push('-i', batchItems[i].outFile);
      const delay = Math.max(0, batchItems[i].startMs);
      filterSegments.push(`[${i}:a]adelay=${delay}|${delay},volume=1.0[a${i}]`);
      amixInputs.push(`[a${i}]`);
    }

    const filterComplex = `${filterSegments.join('; ')}; ${amixInputs.join('')}amix=inputs=${batchItems.length}:duration=first:dropout_transition=0:normalize=0[aout]`;

    ffmpegArgs.push(
      '-filter_complex', filterComplex,
      '-map', '[aout]',
      '-c:a', 'pcm_s16le',
      '-ar', '48000',
      outputWavPath
    );

    await runFfmpeg(ffmpegArgs);
    const duration = await this.probeAudioDuration(outputWavPath);

    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return { audioPath: outputWavPath, durationSeconds: duration, wasUploaded: false, provider: providerUsed };
  }

  /**
   * Generates a warm, ambient luxury lounge music bed using procedural harmonic audio synthesis.
   */
  public async generateAmbientMusicTrack(durationSeconds: number, outputPath: string): Promise<string> {
    const fadeOutStart = Math.max(1, durationSeconds - 2.5);
    const audioSynthFilter = '0.10*sin(2*PI*110*t)+0.07*sin(2*PI*138.59*t)+0.07*sin(2*PI*164.81*t)+0.04*sin(2*PI*207.65*t)';

    await runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', `aevalsrc=${audioSynthFilter}:d=${durationSeconds + 2}:s=48000`,
      '-af', `lowpass=f=420,volume=0.30,afade=t=in:d=1.5,afade=t=out:st=${fadeOutStart}:d=2.5`,
      '-c:a', 'aac',
      '-b:a', '192k',
      outputPath,
    ]);

    return outputPath;
  }

  /**
   * Writes the ASS subtitle file formatted with Libass DirectWrite styling and gold italics.
   * Large, readable 54px typography with subtle black outline and soft shadow.
   */
  public async writeAssSubtitleFile(
    timeline: CaptionsTimeline,
    outputAssPath: string,
    options?: { isHindi?: boolean }
  ): Promise<string> {
    const fontName = options?.isHindi ? 'Nirmala UI' : 'Playfair Display';

    const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: LuxuryCaption,${fontName},52,&H00FFFFFF,&H0037AFD4,&H00050505,&H80000000,1,0,0,0,100,100,1.2,0,1,3,4,2,64,64,${timeline.safeZoneMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${timeline.cues.map((c) => c.assLine).join('\n')}
`;

    await fsPromises.writeFile(outputAssPath, assContent, 'utf8');
    return outputAssPath;
  }

  /**
   * Formats text with ASS tags for champagne gold (&H0037AFD4 in BGR) and italics.
   */
  private formatAssDialogueText(rawText: string, highlightWords: string[]): string {
    let out = rawText.replace(/\*([^*]+)\*/g, '{\\c&H0037AFD4\\i1}$1{\\r}');

    for (const hw of highlightWords) {
      if (!out.includes(`{\\c&H0037AFD4`)) {
        const regex = new RegExp(`\\b(${hw})\\b`, 'gi');
        out = out.replace(regex, '{\\c&H0037AFD4\\i1}$1{\\r}');
      }
    }

    return out;
  }

  /**
   * Probes duration of an audio file using ffprobe.
   */
  public async probeAudioDuration(filePath: string): Promise<number> {
    const ffprobeBin = resolveFfprobeBinary();
    const { stdout } = await execFileAsync(ffprobeBin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    const parsed = parseFloat(stdout.trim());
    return isNaN(parsed) ? 0 : parsed;
  }

  private formatAssTime(seconds: number): string {
    const totalCs = Math.round(Math.max(0, seconds) * 100);
    const cs = totalCs % 100;
    const sec = Math.floor(totalCs / 100) % 60;
    const min = Math.floor(totalCs / 6000) % 60;
    const hr = Math.floor(totalCs / 360000);
    return `${hr}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }
}

export const mockVoiceoverService = new MockVoiceoverService();
