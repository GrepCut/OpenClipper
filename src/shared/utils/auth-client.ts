import { isTauri } from "./platform";

export type OpenClipperAuthClient = "web" | "open-clipper";

export function getAuthClient(): OpenClipperAuthClient {
  return isTauri() ? "open-clipper" : "web";
}
