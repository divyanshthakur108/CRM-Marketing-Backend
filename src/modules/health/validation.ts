import { z } from 'zod';

export const healthQuerySchema = z.object({
  verbose: z.enum(['true', 'false']).optional(),
});

export type HealthQuery = z.infer<typeof healthQuerySchema>;
