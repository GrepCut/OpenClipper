import { isTauri } from "./platform.util";

export type OpenClipperAuthClient = "web" | "open-clipper";

export function getAuthClient(): OpenClipperAuthClient {
  return isTauri() ? "open-clipper" : "web";
}
