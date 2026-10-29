import { Organization } from '../models/Organization.js';

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function createUniqueSlug(name: string): Promise<string> {
  const base = slugify(name) || 'organization';
  let slug = base;
  let count = 1;

  while (await Organization.exists({ slug })) {
    slug = `${base}-${count}`;
    count++;
  }

  return slug;
}
