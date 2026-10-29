import { getDbStatus } from '../../config/db.js';
import { HealthStatus } from './model.js';

export class HealthService {
  public async getHealth(verbose = false): Promise<HealthStatus> {
    const dbStatus = getDbStatus();

    const result: HealthStatus = {
      status: 'ok',
      db: dbStatus,
    };

    if (verbose) {
      result.timestamp = new Date().toISOString();
      result.uptime = process.uptime();
    }

    return result;
  }
}

export const healthService = new HealthService();
