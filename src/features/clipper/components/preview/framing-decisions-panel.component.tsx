import React, { useCallback, useMemo, useState } from "react";
import { Box, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Download,
  Info,
  Layers,
  Scissors,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { appToast } from "../../../../shared/utils/toast.service";
import { importanceAtTime, precedingIndex, resolveLayoutTrack } from "../../engine/autoflip/layout";
import { extractVideoFrameJpeg } from "../../lib/media/video-frame-extract.util";
import { CLIPPER_TRIMMED_SEGMENT_FILE, pathBackedClipperFile } from "../../platform/native-source.util";
import type { ClipperLayoutMode, ClipperSmartCropBlob, ImportanceRegion } from "../../shared/smart-crop.util";
import { clipperTheme } from "../../shared/theme.util";
import type { Theme } from "../../../../theme";
import {
  buildFaultExportSamples,
  FLAT_FRAME_EXPORT_INTERVAL_SEC,
  FLAT_MARGIN_MIN_DURATION_SEC,
  FLAT_MARGIN_RANGE_TOLERANCE,
  FLAT_MARGIN_STEP_TOLERANCE,
  findFaultExportPeriods,
  type FaultExportPeriod,
  type TimelineSample,
} from "./fault-frame-export.util";

interface FramingDecisionsPanelProps {
  analysis: ClipperSmartCropBlob | null | undefined;
  formatId: string | undefined;
  formatLabel: string | undefined;
  projectId: string;
  time: number;
  theme: Theme;
  onSeek?: (time: number) => void;
}

const percent = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? "–" : `${Math.round(value * 100)}%`;

const percentValue = (value: number | undefined) =>
  value == null || !Number.isFinite(value) ? 0 : Math.round(value * 100);

function compactId(id: string | undefined): string {
  if (!id) return "no persistent id";
  return id.length > 22 ? `${id.slice(0, 19)}…` : id;
}

function layoutModeLabel(mode: ClipperLayoutMode): string {
  if (mode === "split") return "Split";
  if (mode === "contain") return "Contain";
  return "Single crop";
}

function roleLabel(role: ImportanceRegion["role"]): string {
  if (role === "primary") return "Primary";
  if (role === "secondary") return "Secondary";
  return "Candidate";
}

function trustLabel(trust: ImportanceRegion["trust"]): string {
  if (trust === "verified-person") return "Verified person";
  if (trust === "temporally-qualified-person") return "Temporally qualified person";
  if (trust === "unverified-person") return "Unverified person";
  if (trust === "video-saliency") return "Saliency";
  return "Object";
}

function timestamp(value: number) {
  const minutes = Math.floor(value / 60);
  return `${minutes}:${(value - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

async function loadTrimmedVideoFile(projectId: string): Promise<File> {
  const filePath = await invoke<string>("get_clipper_project_data_file_path", {
    projectId,
    fileName: CLIPPER_TRIMMED_SEGMENT_FILE,
  });
  return pathBackedClipperFile(filePath);
}

function SectionCard({
  title,
  subtitle,
  children,
  theme,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  theme: Theme;
  action?: React.ReactNode;
}) {
  return (
    <Box
      w="full"
      p={4}
      borderRadius="2xl"
      bg={theme.background.card}
      border="1px solid"
      borderColor={theme.dashboard.border}
      boxShadow="0 4px 20px rgba(0, 0, 0, 0.15)"
    >
      <HStack justify="space-between" align="center" mb={3}>
        <Box minW={0}>
          <Text
            fontSize="xs"
            fontWeight="bold"
            color={theme.text.muted}
            textTransform="uppercase"
            letterSpacing="0.06em"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text fontSize="xs" color={theme.text.secondary} mt={0.5}>
              {subtitle}
            </Text>
          ) : null}
        </Box>
        {action}
      </HStack>
      {children}
    </Box>
  );
}

function TagChip({
  label,
  theme,
  accent = false,
  colorScheme = "accent",
}: {
  label: string;
  theme: Theme;
  accent?: boolean;
  colorScheme?: "accent" | "success" | "warning" | "error" | "info";
}) {
  let bg = theme.surface.active;
  let color = theme.text.secondary;
  let borderColor = theme.border.secondary;

  if (accent || colorScheme !== "info") {
    if (colorScheme === "success") {
      bg = "rgba(34, 197, 94, 0.15)";
      color = "#4ade80";
      borderColor = "rgba(34, 197, 94, 0.3)";
    } else if (colorScheme === "warning") {
      bg = "rgba(234, 179, 8, 0.15)";
      color = "#facc15";
      borderColor = "rgba(234, 179, 8, 0.3)";
    } else if (colorScheme === "error") {
      bg = "rgba(239, 68, 68, 0.15)";
      color = "#f87171";
      borderColor = "rgba(239, 68, 68, 0.3)";
    } else {
      bg = `rgba(${clipperTheme.accentTintRgb},0.18)`;
      color = clipperTheme.accentLight;
      borderColor = clipperTheme.accent;
    }
  }

  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      px={2.5}
      py={0.8}
      mr={1}
      mb={1}
      borderRadius="full"
      fontSize="xs"
      fontWeight="medium"
      bg={bg}
      color={color}
      border="1px solid"
      borderColor={borderColor}
      transition="all 0.15s ease"
    >
      {label}
    </Box>
  );
}

/* ==========================================================================
   Multi-Layer Time-Series Timeline Chart Component
   Features:
     - Smoothed Semantic & Baseline score curves (no zero drop cliffs)
     - Layer 1: Shot Cuts & Scene Boundaries (`cut: true`)
     - Layer 2: Margin Gain Area & Rescue Zones (`visibilityRisk`)
     - Layer 3: Mode & Target Count Ribbon
     - Interactive layer toggles
   ========================================================================== */
function DecisionTimelineChart({
  samples,
  currentTime,
  onSeek,
  theme,
}: {
  samples: Array<{
    t: number;
    semanticScore: number | null;
    baselineScore: number | null;
    selectSemantic: boolean;
    mode: ClipperLayoutMode;
    strategy?: string;
    hasTargets: boolean;
    isUnscored: boolean;
    cut?: boolean;
    visibilityRisk?: boolean;
    targetCount: number;
    targetEvidence?: TimelineSample["targetEvidence"];
  }>;
  currentTime: number;
  onSeek?: (time: number) => void;
  theme: Theme;
}) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showCuts, setShowCuts] = useState(true);
  const [showMargin, setShowMargin] = useState(true);
  const [showRescue, setShowRescue] = useState(true);

  if (!samples.length) return null;

  const minTime = samples[0]!.t;
  const maxTime = samples.at(-1)!.t;
  const timeSpan = Math.max(0.1, maxTime - minTime);

  const width = 340;
  const height = 130;
  const paddingX = 10;
  const paddingTop = 14;
  const paddingBottom = 26;
  const graphH = height - paddingTop - paddingBottom;

  const toX = (t: number) => paddingX + ((t - minTime) / timeSpan) * (width - paddingX * 2);
  const toY = (score: number) => paddingTop + (1 - score) * graphH;

  const scoreSegments = (key: "semanticScore" | "baselineScore") => {
    const segments: string[][] = [];
    let current: string[] = [];
    for (const sample of samples) {
      const score = sample[key];
      if (sample.cut && current.length) {
        segments.push(current);
        current = [];
      }
      if (score == null) {
        if (current.length) segments.push(current);
        current = [];
        continue;
      }
      current.push(`${toX(sample.t)},${toY(score)}`);
    }
    if (current.length) segments.push(current);
    return segments;
  };

  const semanticSegments = scoreSegments("semanticScore");
  const baselineSegments = scoreSegments("baselineScore");
  const bottomY = toY(0);
  const semanticAreaPaths = semanticSegments
    .filter((points) => points.length > 1)
    .map((points) => `M ${points[0]!.split(",")[0]},${bottomY} L ${points.join(" ")} L ${points.at(-1)!.split(",")[0]},${bottomY} Z`);

  const curX = toX(currentTime);

  return (
    <VStack align="stretch" gap={2}>
      {/* Layer Toggles Toolbar */}
      <HStack justify="space-between" align="center" px={1}>
        <Text fontSize="10px" fontWeight="bold" color={theme.text.muted} textTransform="uppercase">
          Layers:
        </Text>
        <HStack gap={1}>
          <Box
            as="button"
            px={2}
            py={0.5}
            borderRadius="full"
            fontSize="10px"
            fontWeight="semibold"
            bg={showCuts ? "rgba(236, 72, 153, 0.2)" : "rgba(255, 255, 255, 0.05)"}
            color={showCuts ? "#ec4899" : theme.text.muted}
            border="1px solid"
            borderColor={showCuts ? "rgba(236, 72, 153, 0.4)" : "transparent"}
            onClick={() => setShowCuts((v) => !v)}
            cursor="pointer"
            display="inline-flex"
            alignItems="center"
            gap={1}
          >
            <Scissors size={10} />
            Cuts
          </Box>
          <Box
            as="button"
            px={2}
            py={0.5}
            borderRadius="full"
            fontSize="10px"
            fontWeight="semibold"
            bg={showMargin ? "rgba(6, 182, 212, 0.2)" : "rgba(255, 255, 255, 0.05)"}
            color={showMargin ? "#06b6d4" : theme.text.muted}
            border="1px solid"
            borderColor={showMargin ? "rgba(6, 182, 212, 0.4)" : "transparent"}
            onClick={() => setShowMargin((v) => !v)}
            cursor="pointer"
            display="inline-flex"
            alignItems="center"
            gap={1}
          >
            Margin Gain
          </Box>
          <Box
            as="button"
            px={2}
            py={0.5}
            borderRadius="full"
            fontSize="10px"
            fontWeight="semibold"
            bg={showRescue ? "rgba(239, 68, 68, 0.2)" : "rgba(255, 255, 255, 0.05)"}
            color={showRescue ? "#f87171" : theme.text.muted}
            border="1px solid"
            borderColor={showRescue ? "rgba(239, 68, 68, 0.4)" : "transparent"}
            onClick={() => setShowRescue((v) => !v)}
            cursor="pointer"
            display="inline-flex"
            alignItems="center"
            gap={1}
          >
            <ShieldAlert size={10} />
            Rescue Zones
          </Box>
        </HStack>
      </HStack>

      <Box
        position="relative"
        w="full"
        borderRadius="xl"
        bg="rgba(10, 14, 23, 0.6)"
        border="1px solid"
        borderColor={theme.dashboard.border}
        p={2}
        cursor={onSeek ? "pointer" : "default"}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "auto", display: "block" }}
          onClick={(e) => {
            if (!onSeek) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const frac = (clickX - (paddingX / width) * rect.width) / (((width - paddingX * 2) / width) * rect.width);
            const clampedFrac = Math.max(0, Math.min(1, frac));
            const seekT = minTime + clampedFrac * timeSpan;
            onSeek(seekT);
          }}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const frac = (clickX - (paddingX / width) * rect.width) / (((width - paddingX * 2) / width) * rect.width);
            const clampedFrac = Math.max(0, Math.min(1, frac));
            setHoverTime(minTime + clampedFrac * timeSpan);
          }}
          onMouseLeave={() => setHoverTime(null)}
        >
          <defs>
            <linearGradient id="timelineSemanticArea" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="rescueBandGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Background Grid Horizontal Lines */}
          {[0, 0.5, 1].map((val) => {
            const y = toY(val);
            return (
              <line
                key={val}
                x1={paddingX}
                y1={y}
                x2={width - paddingX}
                y2={y}
                stroke="rgba(255, 255, 255, 0.08)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            );
          })}

          {/* Layer: Rescue Risk Zone Bands */}
          {showRescue
            ? samples.map((s, idx) => {
                if (!s.visibilityRisk) return null;
                const nextT = samples[idx + 1]?.t ?? s.t + 0.5;
                const x1 = toX(s.t);
                const x2 = toX(nextT);
                const w = Math.max(2, x2 - x1);
                return (
                  <rect
                    key={`rescue-${idx}`}
                    x={x1}
                    y={paddingTop}
                    width={w}
                    height={graphH}
                    fill="url(#rescueBandGrad)"
                  />
                );
              })
            : null}

          {/* Layer: No-target gaps; scores are deliberately not carried through these spans. */}
          {samples.map((s, idx) => {
            if (!s.isUnscored) return null;
            const nextT = samples[idx + 1]?.t ?? s.t + 0.5;
            const x1 = toX(s.t);
            const pending = s.targetEvidence?.status === "temporal-pending";
            return (
              <rect
                key={`no-target-${idx}`}
                x={x1}
                y={paddingTop}
                width={Math.max(1, toX(nextT) - x1)}
                height={graphH}
                fill={pending ? "rgba(234, 179, 8, 0.18)" : "rgba(100, 116, 139, 0.12)"}
              >
                <title>{pending ? "Tracking person evidence before framing" : "No framing target evidence"}</title>
              </rect>
            );
          })}

          {/* Layer: Shot Cut Boundary Markers */}
          {showCuts
            ? samples.map((s, idx) => {
                if (!s.cut && idx !== 0) return null;
                const x = toX(s.t);
                return (
                  <line
                    key={`cut-${idx}`}
                    x1={x}
                    y1={paddingTop - 2}
                    x2={x}
                    y2={height - paddingBottom}
                    stroke="#ec4899"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                    opacity="0.75"
                  />
                );
              })
            : null}

          {/* Mode & Target Count Strip along bottom */}
          {samples.map((s, idx) => {
            const nextT = samples[idx + 1]?.t ?? s.t + 0.5;
            const x1 = toX(s.t);
            const x2 = toX(nextT);
            const w = Math.max(1, x2 - x1);
            let fill = "#64748b"; // default muted
            if (s.hasTargets) {
              if (s.selectSemantic) {
                fill = s.mode === "split" ? "#8b5cf6" : "#10b981";
              } else {
                fill = "#f59e0b";
              }
            }
            return (
              <rect
                key={idx}
                x={x1}
                y={height - paddingBottom + 4}
                width={w}
                height={4}
                fill={fill}
                opacity={0.85}
              />
            );
          })}

          {/* Area Fill for Margin / Semantic Score */}
          {showMargin ? semanticAreaPaths.map((path, index) => <path key={`semantic-area-${index}`} d={path} fill="url(#timelineSemanticArea)" />) : null}

          {/* Baseline Score Line (Dashed Amber) */}
          {baselineSegments.map((points, index) => (
            <polyline
              key={`baseline-${index}`}
              points={points.join(" ")}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.5"
              strokeDasharray="3 3"
              opacity="0.85"
            />
          ))}

          {/* Semantic Score Line (Solid Glowing Cyan) */}
          {semanticSegments.map((points, index) => (
            <polyline
              key={`semantic-${index}`}
              points={points.join(" ")}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Hover indicator line */}
          {hoverTime != null ? (
            <line
              x1={toX(hoverTime)}
              y1={paddingTop}
              x2={toX(hoverTime)}
              y2={height - paddingBottom}
              stroke="rgba(255, 255, 255, 0.5)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          ) : null}

          {/* Current Video Time Cursor */}
          <g>
            <line
              x1={curX}
              y1={paddingTop - 4}
              x2={curX}
              y2={height - paddingBottom + 6}
              stroke="#ffffff"
              strokeWidth="2"
              filter="drop-shadow(0 0 4px rgba(255,255,255,0.8))"
            />
            <polygon
              points={`${curX - 4},${paddingTop - 6} ${curX + 4},${paddingTop - 6} ${curX},${paddingTop}`}
              fill="#ffffff"
            />
          </g>
        </svg>

        {/* Floating time badge */}
        <Box
          position="absolute"
          top={2}
          right={2}
          px={2}
          py={0.5}
          borderRadius="md"
          bg="rgba(15, 23, 42, 0.8)"
          fontSize="10px"
          color={theme.text.muted}
          pointerEvents="none"
        >
          {hoverTime != null ? `Scrub: ${timestamp(hoverTime)}` : `Time: ${timestamp(currentTime)}`}
        </Box>
      </Box>

      {/* Timeline Legend */}
      <HStack justify="space-between" fontSize="10px" color={theme.text.muted} px={1}>
        <HStack gap={1.5}>
          <Box w={3} h={0.5} bg="#06b6d4" borderRadius="full" />
          <Text color="#06b6d4" fontWeight="medium">Semantic</Text>
        </HStack>
        <HStack gap={1.5}>
          <Box w={3} h={0.5} bg="#f59e0b" borderRadius="full" style={{ borderStyle: "dashed" }} />
          <Text color="#f59e0b" fontWeight="medium">Baseline</Text>
        </HStack>
        <HStack gap={1.5}>
          <Box w={2} h={2} borderRadius="xs" bg="#10b981" />
          <Text>Single</Text>
          <Box w={2} h={2} borderRadius="xs" bg="#8b5cf6" ml={1} />
          <Text>Split</Text>
          <Box w={2} h={2} borderRadius="xs" bg="#f59e0b" ml={1} />
          <Text>Baseline</Text>
          <Box w={2} h={2} borderRadius="xs" bg="#64748b" ml={1} />
          <Text>No targets</Text>
        </HStack>
      </HStack>
    </VStack>
  );
}

/* ==========================================================================
   Main Framing Decisions Panel Component
   ========================================================================== */
export function FramingDecisionsPanel({
  analysis,
  formatId,
  time,
  theme,
  onSeek,
  projectId,
}: FramingDecisionsPanelProps) {
  const [exportingFlatFrames, setExportingFlatFrames] = useState(false);
  const data = useMemo(() => {
    if (!analysis || !formatId) return null;
    const track = resolveLayoutTrack(analysis.layoutTracks, formatId);
    if (!track?.samples.length) return null;

    const samples = track.samples;
    const index = precedingIndex(samples.map((sample) => ({ time: sample.t })), time);
    const decision = index >= 0 ? samples[index] : undefined;
    const regions = importanceAtTime(analysis.importanceSamples ?? [], time).regions;
    const rankedEntities = (analysis.compositionMemory?.rankedEntityIds ?? [])
      .map((id) => analysis.compositionMemory?.entities.find((entity) => entity.id === id))
      .filter((entity): entity is NonNullable<typeof entity> => entity != null)
      .slice(0, 6);
    const alternatives = decision?.candidateVariants ?? [];

    const timelineSamples = samples.map((s) => {
      const targetCount = s.requiredRegionIds?.length ?? 0;
      const hasTargets = targetCount > 0;
      const rawSem = hasTargets && Number.isFinite(s.semanticScore) ? s.semanticScore! : null;
      const rawBase = hasTargets && Number.isFinite(s.baselineScore) ? s.baselineScore! : null;

      const selectSemantic = s.strategy !== "legacy-baseline" && s.strategy != null;
      const visibilityRisk = s.visibilityRisk === true || (s.baselineRequiredCoverage != null && s.baselineRequiredCoverage[0]! < 0.85);

      return {
        t: s.t,
        semanticScore: rawSem,
        baselineScore: rawBase,
        selectSemantic,
        mode: s.mode,
        strategy: s.strategy,
        hasTargets,
        isUnscored: rawSem == null || rawBase == null,
        cut: s.cut === true,
        visibilityRisk,
        targetCount,
        reasonCodes: s.reasonCodes,
        targetEvidence: s.targetEvidence,
      };
    });

    // Smooth only a continuous scored run. Missing targets and cuts are facts,
    // not a reason to paint a plausible-looking score from neighbouring frames.
    const smoothedTimeline = timelineSamples.map((curr, i, arr) => {
      if (curr.semanticScore == null || curr.baselineScore == null) return curr;
      const previous = arr[i - 1];
      const following = arr[i + 1];
      const prev = previous?.semanticScore != null && previous.baselineScore != null && !previous.cut && !curr.cut
        ? previous
        : curr;
      const next = following?.semanticScore != null && following.baselineScore != null && !following.cut && !curr.cut
        ? following
        : curr;
      const smoothSem = prev.semanticScore * 0.25 + curr.semanticScore * 0.5 + next.semanticScore * 0.25;
      const smoothBase = prev.baselineScore * 0.25 + curr.baselineScore * 0.5 + next.baselineScore * 0.25;
      return {
        ...curr,
        semanticScore: Math.max(0, Math.min(1, smoothSem)),
        baselineScore: Math.max(0, Math.min(1, smoothBase)),
      };
    });

    return { decision, regions, rankedEntities, alternatives, timelineSamples: smoothedTimeline };
  }, [analysis, formatId, time]);

  const exportFlatMarginFrames = useCallback(async () => {
    const periods = findFaultExportPeriods(data?.timelineSamples ?? []);
    if (!periods.length) {
      appToast.info(
        "No fault periods found",
        "No flat Margin Gain run or no-score gap lasting at least 4 seconds was found.",
      );
      return;
    }

    setExportingFlatFrames(true);
    const loadingToast = appToast.loading("Exporting fault frames", "Preparing diagnostic stills…");
    try {
      const videoFile = await loadTrimmedVideoFile(projectId);
      const runName = `fault-frames-${new Date().toISOString().replace(/[:.]/g, "-")}`;
      const frameManifest: Array<{
        file: string;
        timeSec: number;
        periodKind: FaultExportPeriod["kind"];
        semanticScore: number | null;
        baselineScore: number | null;
        marginGain: number | null;
        period: number;
        targetCount: number;
        strategy?: string;
        reasonCodes?: string[];
        targetEvidence?: TimelineSample["targetEvidence"];
      }> = [];
      let exportDir = "";
      let frameNumber = 0;

      for (const [periodIndex, period] of periods.entries()) {
        const exportSamples = buildFaultExportSamples(period);
        for (const sample of exportSamples) {
          const frame = await extractVideoFrameJpeg(videoFile, sample.t);
          const kindSuffix = period.kind === "no-score" ? "_no-score" : "";
          const fileName = `period-${String(periodIndex + 1).padStart(2, "0")}_t-${sample.t.toFixed(2).replace(".", "-")}${kindSuffix}.jpg`;
          exportDir = await invoke<string>("write_clipper_project_diagnostic_file", {
            projectId,
            runName,
            fileName,
            contents: frame,
          });
          const marginGain = sample.semanticScore != null && sample.baselineScore != null
            ? sample.semanticScore - sample.baselineScore
            : null;
          frameManifest.push({
            file: fileName,
            timeSec: sample.t,
            periodKind: period.kind,
            semanticScore: sample.semanticScore,
            baselineScore: sample.baselineScore,
            marginGain,
            period: periodIndex + 1,
            targetCount: sample.targetCount,
            strategy: sample.strategy,
            reasonCodes: sample.reasonCodes,
            targetEvidence: sample.targetEvidence,
          });
          frameNumber += 1;
        }
      }

      await invoke<string>("write_clipper_project_diagnostic_file", {
        projectId,
        runName,
        fileName: "manifest.json",
        contents: new TextEncoder().encode(JSON.stringify({
          criterion: {
            minDurationSec: FLAT_MARGIN_MIN_DURATION_SEC,
            exportIntervalSec: FLAT_FRAME_EXPORT_INTERVAL_SEC,
            flatMargin: {
              metric: "semanticScore - baselineScore",
              stepTolerance: FLAT_MARGIN_STEP_TOLERANCE,
              rangeTolerance: FLAT_MARGIN_RANGE_TOLERANCE,
            },
            noScore: {
              metric: "missing semantic/baseline score or no targets",
            },
          },
          periods: periods.map((period, index) => ({
            period: index + 1,
            kind: period.kind,
            startTimeSec: period.startTime,
            endTimeSec: period.endTime,
            durationSec: period.endTime - period.startTime,
          })),
          frames: frameManifest,
        }, null, 2)),
      });
      await navigator.clipboard.writeText(exportDir);
      const flatCount = periods.filter((period) => period.kind === "flat-margin").length;
      const noScoreCount = periods.filter((period) => period.kind === "no-score").length;
      appToast.update(
        loadingToast,
        "success",
        "Fault frames exported",
        `${frameNumber} still(s) in ${periods.length} period(s) (${flatCount} flat margin, ${noScoreCount} no-score). The folder path was copied to the clipboard.`,
      );
    } catch (error) {
      appToast.update(loadingToast, "error", "Could not export diagnostic frames", String(error));
    } finally {
      setExportingFlatFrames(false);
    }
  }, [data?.timelineSamples, projectId]);

  if (!data?.decision) {
    return (
      <Box flex="1" minH={0} overflowY="auto" px={2} pb={2}>
        <Box
          w="full"
          p={6}
          borderRadius="2xl"
          bg={theme.background.card}
          border="1px solid"
          borderColor={theme.dashboard.border}
          textAlign="center"
        >
          <Text fontSize="sm" color={theme.text.secondary}>
            No framing decision recorded for this frame.
          </Text>
        </Box>
      </Box>
    );
  }

  const { decision, regions, rankedEntities, alternatives, timelineSamples } = data;
  const selectedSemantic = decision.strategy !== "legacy-baseline" && decision.strategy != null;
  const rejectedLabel = selectedSemantic
    ? "AutoFlip baseline"
    : `semantic ${decision.candidateMode ?? "proposal"}`;

  const currentSample = timelineSamples.find((s) => Math.abs(s.t - decision.t) < 0.05) ?? {
    semanticScore: decision.semanticScore ?? null,
    baselineScore: decision.baselineScore ?? null,
    hasTargets: decision.requiredRegionIds.length > 0,
    targetEvidence: decision.targetEvidence,
  };

  const semScore = currentSample.semanticScore;
  const baseScore = currentSample.baselineScore;

  return (
    <Box flex="1" minH={0} overflowY="auto" px={2} pb={2}>
      <VStack align="stretch" gap={3}>
        {/* Multi-Layer Time-Series Timeline Chart */}
        <SectionCard
          title="Score Dynamics Over Time"
          subtitle="Click timeline to seek video time · export finds flat Margin Gain runs or no-score gaps ≥ 4 s at 0.5 s intervals"
          theme={theme}
          action={
            <HStack gap={2}>
              <Box
                as="button"
                type="button"
                onClick={() => void exportFlatMarginFrames()}
                disabled={exportingFlatFrames}
                px={2}
                py={1}
                borderRadius="md"
                border="1px solid"
                borderColor="rgba(6, 182, 212, 0.45)"
                bg="rgba(6, 182, 212, 0.12)"
                color="#67e8f9"
                fontSize="10px"
                fontWeight="semibold"
                cursor={exportingFlatFrames ? "wait" : "pointer"}
                opacity={exportingFlatFrames ? 0.65 : 1}
                display="inline-flex"
                alignItems="center"
                gap={1}
              >
                <Download size={12} />
                {exportingFlatFrames ? "Exporting…" : "Export fault frames"}
              </Box>
              <Activity size={15} color={theme.text.muted} />
            </HStack>
          }
        >
          <DecisionTimelineChart
            samples={timelineSamples}
            currentTime={time}
            onSeek={onSeek}
            theme={theme}
          />
        </SectionCard>

        {/* Section: Reasoning & Arbiter Details */}
        <SectionCard title="Arbiter Evaluation" theme={theme} action={<Target size={15} color={theme.text.muted} />}>
          <VStack align="stretch" gap={2.5}>
            <Box w="full">
              <HStack justify="space-between" mb={1}>
                <Text fontSize="xs" color={theme.text.secondary}>Semantic Score</Text>
                <Text fontSize="xs" color="#06b6d4" fontWeight="bold">{percent(semScore)}</Text>
              </HStack>
              <Progress.Root value={percentValue(semScore)} size="xs">
                <Progress.Track bg={theme.surface.active} borderRadius="full">
                  <Progress.Range bg="#06b6d4" borderRadius="full" />
                </Progress.Track>
              </Progress.Root>
            </Box>

            <Box w="full">
              <HStack justify="space-between" mb={1}>
                <Text fontSize="xs" color={theme.text.secondary}>Baseline Score</Text>
                <Text fontSize="xs" color="#f59e0b" fontWeight="bold">{percent(baseScore)}</Text>
              </HStack>
              <Progress.Root value={percentValue(baseScore)} size="xs">
                <Progress.Track bg={theme.surface.active} borderRadius="full">
                  <Progress.Range bg="#f59e0b" borderRadius="full" />
                </Progress.Track>
              </Progress.Root>
            </Box>

            <Text fontSize="xs" color={theme.text.primary} mt={1}>
              Rejected: <Box as="span" fontWeight="semibold" color={theme.text.muted}>{rejectedLabel}</Box>.
              {decision.decisionConfidence != null ? ` Confidence: ${percent(decision.decisionConfidence)}.` : ""}
            </Text>
            {!currentSample.hasTargets && currentSample.targetEvidence?.status === "temporal-pending" ? (
              <Text fontSize="xs" color="#facc15">
                Tracking a detector-only person before it is allowed to steer framing.
              </Text>
            ) : !currentSample.hasTargets ? (
              <Text fontSize="xs" color={theme.text.muted}>No eligible framing target was detected.</Text>
            ) : null}
          </VStack>
        </SectionCard>

        <SectionCard title="Why (Reason Codes)" theme={theme} action={<Info size={15} color={theme.text.muted} />}>
          {decision.reasonCodes?.length ? (
            <Box>
              {decision.reasonCodes.map((code) => (
                <TagChip key={code} label={code} theme={theme} accent />
              ))}
            </Box>
          ) : (
            <Text fontSize="sm" color={theme.text.secondary}>No additional reason codes.</Text>
          )}
        </SectionCard>

        {/* Section: Project Memory */}
        <SectionCard title="Project Memory" theme={theme} action={<TrendingUp size={15} color={theme.text.muted} />}>
          {rankedEntities.length ? (
            <VStack align="stretch" gap={2}>
              {rankedEntities.map((entity, index) => (
                <HStack
                  key={entity.id}
                  justify="space-between"
                  align="start"
                  gap={2}
                  p={2.5}
                  borderRadius="xl"
                  bg={theme.surface.active}
                  transition="all 0.15s ease"
                  _hover={{ bg: "rgba(255, 255, 255, 0.05)" }}
                >
                  <Box minW={0}>
                    <Text fontSize="xs" fontWeight="bold" color={theme.text.primary}>
                      #{index + 1} · {entity.kind}{entity.label ? ` (${entity.label})` : ""}
                    </Text>
                    <Text fontSize="10px" color={theme.text.muted} lineClamp={1}>
                      {compactId(entity.id)}
                    </Text>
                  </Box>
                  <VStack align="end" gap={0} flexShrink={0}>
                    <Text fontSize="xs" fontWeight="semibold" color="#34d399">{percent(entity.importanceScore)} imp.</Text>
                    <Text fontSize="10px" color={theme.text.muted}>{percent(entity.continuity)} cont.</Text>
                  </VStack>
                </HStack>
              ))}
            </VStack>
          ) : (
            <Text fontSize="xs" color={theme.text.secondary}>
              No persistent identities; decision uses current-frame signals only.
            </Text>
          )}
        </SectionCard>

        {/* Section: Frame Candidates */}
        <SectionCard title="Frame Candidates" theme={theme} action={<Target size={15} color={theme.text.muted} />}>
          {regions.length ? (
            <VStack align="stretch" gap={2}>
              {regions.slice(0, 6).map((region) => (
                <Box
                  key={region.id}
                  p={2.5}
                  borderRadius="xl"
                  bg={theme.surface.active}
                  borderLeft="3px solid"
                  borderLeftColor={region.role === "primary" ? "#34d399" : theme.border.secondary}
                >
                  <HStack gap={1.5} flexWrap="wrap" mb={1}>
                    <TagChip label={roleLabel(region.role)} theme={theme} accent={region.role === "primary"} />
                    <TagChip label={trustLabel(region.trust)} theme={theme} />
                    {region.required ? <TagChip label="Required" theme={theme} colorScheme="warning" /> : null}
                  </HStack>
                  <Text fontSize="xs" fontWeight="medium" color={theme.text.primary}>
                    {region.kind} · {region.sources.join(" + ")}
                  </Text>
                  <Text fontSize="10px" color={theme.text.muted} mt={0.5}>
                    {compactId(region.projectIdentityId)} · local {percent(region.importanceScore)}
                    {region.compositionScore != null ? ` · memory ${percent(region.compositionScore)}` : ""}
                  </Text>
                </Box>
              ))}
            </VStack>
          ) : (
            <Text fontSize="xs" color={theme.text.secondary}>No reliable candidates in this frame.</Text>
          )}
        </SectionCard>

        {/* Section: Coverage & Alternatives */}
        <SectionCard title="Coverage & Alternatives" theme={theme} action={<Layers size={15} color={theme.text.muted} />}>
          <Text fontSize="xs" color={theme.text.primary} mb={2}>
            Required regions: <Box as="span" fontWeight="bold">{decision.requiredRegionIds.length || "none"}</Box> · baseline coverage:{" "}
            <Box as="span" fontWeight="bold" color="#f59e0b">{decision.baselineRequiredCoverage?.map(percent).join(", ") || "–"}</Box> · selected:{" "}
            <Box as="span" fontWeight="bold" color="#34d399">{decision.selectedRequiredCoverage?.map(percent).join(", ") || "–"}</Box>
          </Text>
          {alternatives.length ? (
            <VStack align="stretch" gap={2}>
              {alternatives.map((variant) => (
                <HStack
                  key={variant.kind}
                  justify="space-between"
                  align="center"
                  p={2.5}
                  borderRadius="xl"
                  bg={theme.surface.active}
                  gap={2}
                >
                  <Box minW={0}>
                    <Text fontSize="xs" fontWeight="bold" color={theme.text.primary}>{variant.kind}</Text>
                    <Text fontSize="10px" color={theme.text.muted}>
                      {layoutModeLabel(variant.mode)} · {variant.viewports.length} viewport{variant.viewports.length === 1 ? "" : "s"}
                    </Text>
                  </Box>
                  <Text fontSize="xs" color={theme.text.secondary} flexShrink={0} fontWeight="medium">
                    {variant.requiredCoverage.map(percent).join(", ") || "–"}
                  </Text>
                </HStack>
              ))}
            </VStack>
          ) : (
            <Text fontSize="xs" color={theme.text.secondary}>No additional variants for this frame.</Text>
          )}
        </SectionCard>
      </VStack>
    </Box>
  );
}
