export interface Env {
  DB: D1Database;
  FOOTBALL_DATA_KEY: string;
  ONESIGNAL_APP_ID?: string;
  ONESIGNAL_API_KEY?: string;
  ONESIGNAL_SEGMENT: string;
}

export const DAY = 86_400_000;
