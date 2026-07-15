export interface GoogleDriveTokenResponse {
  accessToken: string;
}

export interface GoogleDriveStatusResponse {
  connected: boolean;
}

export interface GetAccessTokenResponse {
  success: boolean;
  data?: GoogleDriveTokenResponse;
}
