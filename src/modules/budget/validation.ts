import { z } from 'zod';
import { AppError } from '../../utils/AppError.js';

export interface ParsedMonthYear {
  month: number;
  year: number;
}

export function parseMonthParam(param: string, queryYear?: string): ParsedMonthYear {
  if (!param) {
    throw AppError.badRequest('Month parameter is required');
  }

  // Handle YYYY-MM format (e.g., "2026-11")
  if (/^\d{4}-\d{1,2}$/.test(param)) {
    const [yStr, mStr] = param.split('-');
    const year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    if (month < 1 || month > 12) {
      throw AppError.badRequest('Month must be between 1 and 12');
    }
    return { month, year };
  }

  // Handle month name (e.g., "November 2026" or "November")
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const lower = param.toLowerCase().trim();
  const matchedNameIdx = monthNames.findIndex((m) => lower.startsWith(m));
  if (matchedNameIdx !== -1) {
    const month = matchedNameIdx + 1;
    const yearMatch = lower.match(/\b(20\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : (queryYear ? parseInt(queryYear, 10) : new Date().getFullYear());
    return { month, year };
  }

  // Handle numeric month (e.g., "11")
  const mNum = parseInt(param, 10);
  if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
    const year = queryYear ? parseInt(queryYear, 10) : new Date().getFullYear();
    return { month: mNum, year };
  }

  throw AppError.badRequest(`Invalid month format "${param}". Use YYYY-MM (e.g. 2026-11) or 1-12.`);
}

export const projectAllocationSchema = z.object({
  projectId: z.string().min(1, 'Project ID is required'),
  projectName: z.string().optional().default(''),
  amount: z.number().min(0, 'Allocation amount cannot be negative'),
  metaAds: z.number().min(0).optional().default(0),
  googleAds: z.number().min(0).optional().default(0),
  linkedinAds: z.number().min(0).optional().default(0),
  directWhatsapp: z.number().min(0).optional().default(0),
});

export const updateBudgetSchema = z.object({
  overallCap: z.number().min(0, 'Overall budget cap cannot be negative'),
  currency: z.string().optional().default('INR'),
  projectAllocations: z.array(projectAllocationSchema).default([]),
});

export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
