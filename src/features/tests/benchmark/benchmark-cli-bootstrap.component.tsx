import { useEffect, useState } from "react";
import { isTauri } from "../../../shared/utils/platform.util";
import { ensureTauriFrontendSession } from "../../../shared/utils/tauri-native-jobs.util";
import { getBenchmarkCliRequest, runBenchmarkCli, type BenchmarkCliRequest } from "./benchmark-cli.util";

function BenchmarkCliReadySignal() {
  useEffect(() => {
    if (!isTauri()) return;
    void ensureTauriFrontendSession().catch(() => {});
  }, []);
  return null;
}

export function BenchmarkCliShell() {
  const [request, setRequest] = useState<BenchmarkCliRequest | null | "loading">("loading");

  useEffect(() => {
    if (!isTauri()) {
      setRequest(null);
      return;
    }
    void getBenchmarkCliRequest().then((value) => setRequest(value ?? null));
  }, []);

  useEffect(() => {
    if (request === "loading" || !request) return;
    document.getElementById("open-clipper-boot-shell")?.remove();
    let cancelled = false;
    void (async () => {
      try {
        await runBenchmarkCli(request);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("finish_benchmark_cli_command", {
          summary: {
            datasetId: request.datasetId,
            datasetName: request.datasetId,
            runId: "",
            status: "failed",
            mode: request.check ? "check" : "process",
            completedClips: 0,
            failedClips: 0,
            manifestPath: null,
            driftSummary: null,
            error: message,
            clips: [],
          },
        }).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (request === "loading") return null;
  if (!request) return null;
  return <BenchmarkCliReadySignal />;
}

export function useBenchmarkCliRequest(): BenchmarkCliRequest | null | "loading" {
  const [request, setRequest] = useState<BenchmarkCliRequest | null | "loading">("loading");
  useEffect(() => {
    if (!isTauri()) {
      setRequest(null);
      return;
    }
    void getBenchmarkCliRequest().then((value) => setRequest(value ?? null));
  }, []);
  return request;
}
