import type { User } from "../../shared/types/auth.types";

export interface LoginResponse {
  sessionId: string;
  token: string;
  refreshToken: string;
  tokenExpires: number;
  user: User;
}

export interface RefreshResponse {
  sessionId: string;
  token: string;
  refreshToken: string;
  tokenExpires: number;
}
