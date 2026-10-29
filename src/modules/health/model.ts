export interface HealthStatus {
  status: 'ok';
  db: 'connected' | 'disconnected';
  timestamp?: string;
  uptime?: number;
}
