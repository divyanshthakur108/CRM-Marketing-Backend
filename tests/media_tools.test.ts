import { describe, it, expect } from 'vitest';
import { escapeFilterPath, toContainerPath } from '../src/utils/ffmpeg.js';

// MEDIA_TOOLS=docker: host paths under the backend folder must become /work/... inside the container
describe('toContainerPath (Docker media tools)', () => {
  describe('macOS / Linux host', () => {
    const root = '/Users/dev/CRM-Marketing-Backend';

    it('rewrites a plain file path', () => {
      expect(toContainerPath(`${root}/storage/scratch/a.mp4`, root)).toBe('/work/storage/scratch/a.mp4');
    });

    it('rewrites a path inside a filter string', () => {
      const filter = `subtitles=filename=${escapeFilterPath(`${root}/storage/x.ass`)}:fontsdir=${escapeFilterPath(`${root}/assets/fonts`)}`;
      expect(toContainerPath(filter, root)).toBe('subtitles=filename=/work/storage/x.ass:fontsdir=/work/assets/fonts');
    });

    it('leaves options and paths outside the backend folder alone', () => {
      expect(toContainerPath('-c:v', root)).toBe('-c:v');
      expect(toContainerPath('/tmp/other.mp4', root)).toBe('/tmp/other.mp4');
    });
  });

  describe('Windows host', () => {
    const root = 'C:\\Users\\dev\\CRM-Marketing-Backend';

    it('rewrites a backslash path and turns the rest into forward slashes', () => {
      expect(toContainerPath(`${root}\\storage\\scratch\\a.mp4`, root)).toBe('/work/storage/scratch/a.mp4');
    });

    it('rewrites a forward-slash path', () => {
      expect(toContainerPath('C:/Users/dev/CRM-Marketing-Backend/storage/a.mp4', root)).toBe('/work/storage/a.mp4');
    });

    it('rewrites an escaped filter path (drive colon escaped)', () => {
      const filter = `ametadata=print:file=${escapeFilterPath(`${root}\\storage\\scratch\\levels.txt`)}`;
      expect(filter).toContain('C\\:/Users/dev');
      expect(toContainerPath(filter, root)).toBe('ametadata=print:file=/work/storage/scratch/levels.txt');
    });
  });
});
