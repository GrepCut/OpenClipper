import type { ConversionOptions, Input, OutputFormat } from "mediabunny";
import type { ConversionOutput } from "./converter.types";

export interface MediabunnyConvertConfig {
  createFormat: (mode: ConversionOutput["kind"]) => OutputFormat;
  mimeType: string;
  video?: ConversionOptions["video"];
  audio?: ConversionOptions["audio"];
  trim?: ConversionOptions["trim"];
  prepare?: (
    input: Input,
    file: File,
  ) => Promise<Pick<MediabunnyConvertConfig, "video" | "audio">>;
  stage?: string;
}
