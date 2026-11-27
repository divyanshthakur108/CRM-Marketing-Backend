import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildCleanFilter, buildCleanFilters, describeFixes, measureTilt, targetSize } from '../src/modules/creativelab/cleanup.js';
import { cleanFixPlan } from '../src/modules/creativelab/knowledge.js';

const bars = async () => {
  const svg = `<svg width="800" height="1200"><rect width="100%" height="100%" fill="#ddd"/>${Array.from({ length: 10 }, (_, i) => `<rect x="${40 + i * 75}" y="0" width="30" height="1200" fill="#444"/>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

describe('clean-up', () => {
  it('measures tilt from vertical edges (returns the clockwise fix)', async () => {
    const base = await bars();
    for (const deg of [0, 2, -3.5, 5]) {
      const img = await sharp(base).rotate(deg, { background: '#ddd' }).extract({ left: 150, top: 150, width: 500, height: 800 }).png().toBuffer();
      const r = await measureTilt(img);
      expect(Math.abs(r.degrees - -deg)).toBeLessThanOrEqual(0.5);
      if (deg !== 0) expect(r.confidence).toBeGreaterThan(0.3);
    }
  });

  it('cleans an unknown plan to safe defaults and clamps tilt', () => {
    expect(cleanFixPlan({ tiltDegrees: 40, keystone: 'sideways', noise: 'high' })).toMatchObject({ tiltDegrees: 10, keystone: 'none', noise: 'high', exposure: 'ok' });
  });

  it('turns upside-down and sideways pictures the right way', () => {
    const up = buildCleanFilter({ kind: 'video', width: 464, height: 832, plan: cleanFixPlan({ orientation: 'upside_down' }) });
    expect(up.startsWith('deflicker=mode=pm:size=10,hflip,vflip')).toBe(true);
    const side = buildCleanFilter({ kind: 'image', width: 1600, height: 720, plan: cleanFixPlan({ orientation: 'turn_left' }) });
    expect(side).toContain('transpose=2');
    expect(side).toContain('scale=864:1920'); // frame is portrait after the quarter turn
    expect(cleanFixPlan({ orientation: 'sideways' }).orientation).toBe('ok');
  });

  it('builds the filter chain from the plan', () => {
    const plan = cleanFixPlan({ tiltDegrees: -2, keystone: 'converge_down', noise: 'medium', exposure: 'dark' });
    const f = buildCleanFilter({ kind: 'video', width: 464, height: 832, plan, stabilize: true, transformsPath: '/tmp/x.trf' });
    expect(f).toMatch(/^vidstabtransform=/);
    expect(f).toContain('rotate=-0.0349');
    expect(f).toContain('perspective=');
    expect(f).toContain('hqdn3d=3:2.5:6:4.5');
    expect(f).toContain('deflicker=');
    expect(f).toContain('gamma=1.12');
    expect(f).toContain('scale=1070:1920');
    expect(f.endsWith('format=yuv420p')).toBe(true);
    expect(targetSize(1600, 720)).toEqual({ w: 1920, h: 864 });
    expect(describeFixes({ kind: 'image', width: 1920, height: 1080, plan: cleanFixPlan({}) })).not.toContain('Straightened');
  });

  it('with Real-ESRGAN: no heavy denoise before, only resize + light sharpen after', () => {
    const { pre, post } = buildCleanFilters({ kind: 'video', width: 464, height: 832, plan: cleanFixPlan({ noise: 'medium' }), aiUpscale: true });
    expect(pre.some((x) => x.startsWith('hqdn3d'))).toBe(false);
    expect(post).toEqual(['scale=1070:1920:flags=lanczos', 'unsharp=3:3:0.3:3:3:0', 'format=yuv420p']);
    expect(describeFixes({ kind: 'video', width: 464, height: 832, plan: cleanFixPlan({}), aiUpscale: true }).join(' ')).toContain('Real-ESRGAN');
  });
});
