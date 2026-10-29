export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
  isPlatformAdmin?: boolean;
  onboardingStatus?: string;
}

export interface AuthResponse {
  user: UserSession;
  accessToken: string;
  refreshToken?: string;
  organizations?: Array<{
    id: string;
    name: string;
    role: string;
    status: string;
  }>;
}
