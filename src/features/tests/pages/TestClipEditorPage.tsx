import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, Slider, Text, VStack } from "@chakra-ui/react";
import { Maximize2, Plus, Save, Trash2, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLoader } from "../../../shared/components/AppLoader";
import { OutlinedActionButton } from "../../../shared/components/buttons/OutlinedActionButton";
import { appToast } from "../../../shared/utils/toast.service";
import { useTheme } from "../../../theme";
import { ClipperLayout } from "../../clipper/components/ClipperLayout";
import {
  evaluateGroundTruth,
  evaluateLayoutIntent,
  normalizeKeyframes,
} from "../benchmark/ground-truth";
import {
  clampTargetRect,
  defaultContainRect,
  defaultTargetRect,
  finalizeTargetRect,
  resizeTargetFree,
  resizeTargetFromCorner,
  stageNormToSourceNorm,
  targetCenter,
  targetToStagePercent,
  videoContentInset,
  type NormalizedInset,
} from "../benchmark/target-geometry";
import { testDataService } from "../test-data.service";
import type { TestClip, TestDataset, TestKeyframe, TestLayoutIntent, TestTarget } from "../types";

const TARGET_COLORS = ["#22D3EE", "#F472B6"];
const CONTAIN_COLOR = "#FBBF24";
const KEYFRAME_TIME_TOLERANCE_US = 1_000;

function formatTime(time: number): string {
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}.${Math.floor((time % 1) * 10)}`;
}

function freshTarget(slot: 0 | 1, clip: TestClip, x = 0.5, y = 0.5): TestTarget {
  const rect = defaultTargetRect(clip.width, clip.height, x, y);
  return { id: crypto.randomUUID(), slot, ...rect };
}

function freshContainTarget(clip: TestClip): TestTarget {
  const rect = defaultContainRect(clip.width, clip.height);
  return { id: crypto.randomUUID(), slot: 0, ...rect };
}

export function TestClipEditorPage() {
  const { datasetId = "", clipId = "" } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  const keyframesRef = useRef<TestKeyframe[]>([]);
  const currentTimeRef = useRef(0);
  const draftTargetsRef = useRef<TestTarget[]>([]);
  const draftLayoutIntentRef = useRef<TestLayoutIntent>("crop");
  const clipRef = useRef<TestClip | null>(null);
  const [dataset, setDataset] = useState<TestDataset | null>(null);
  const [clip, setClip] = useState<TestClip | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [keyframes, setKeyframes] = useState<TestKeyframe[]>([]);
  const [draftTargets, setDraftTargets] = useState<TestTarget[]>([]);
  const [draftLayoutIntent, setDraftLayoutIntent] = useState<TestLayoutIntent>("crop");
  const [currentTime, setCurrentTime] = useState(0);
  const [geometryChanged, setGeometryChanged] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 });
  const [contentInset, setContentInset] = useState<NormalizedInset>({ x: 0, y: 0, width: 1, height: 1 });
  const [loading, setLoading] = useState(true);

  const sourceWidth = sourceSize.width || clip?.width || 0;
  const sourceHeight = sourceSize.height || clip?.height || 0;

  const refreshContentInset = () => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;
    const width = sourceSize.width || clipRef.current?.width || video.videoWidth;
    const height = sourceSize.height || clipRef.current?.height || video.videoHeight;
    if (!width || !height) return;
    setContentInset(videoContentInset(stage.clientWidth, stage.clientHeight, width, height));
  };

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      testDataService.getDataset(datasetId),
      testDataService.getClip(clipId),
      testDataService.getAnnotations(clipId),
      testDataService.playableClip(clipId),
    ]).then(([loadedDataset, loadedClip, annotations, playable]) => {
      if (disposed) return;
      const normalized = normalizeKeyframes(annotations, loadedClip.width, loadedClip.height);
      const initialIntent = normalized.length
        ? evaluateLayoutIntent(normalized, 0)
        : "crop";
      const initial = normalized.length
        ? evaluateGroundTruth(normalized, 0, loadedClip.width, loadedClip.height)
        : [freshTarget(0, loadedClip)];
      setDataset(loadedDataset);
      setClip(loadedClip);
      clipRef.current = loadedClip;
      setKeyframes(normalized);
      keyframesRef.current = normalized;
      setSourceSize({ width: loadedClip.width, height: loadedClip.height });
      setUrl(playable.url);
      draftTargetsRef.current = initial;
      draftLayoutIntentRef.current = initialIntent;
      setDraftTargets(initial);
      setDraftLayoutIntent(initialIntent);
      initialized.current = true;
    }).catch((error) => appToast.error("Could not load test clip", String(error))).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [clipId, datasetId]);

  useEffect(() => {
    if (!initialized.current || !geometryChanged) return;
    setSaveState("dirty");
  }, [geometryChanged]);

  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { draftTargetsRef.current = draftTargets; }, [draftTargets]);
  useEffect(() => { draftLayoutIntentRef.current = draftLayoutIntent; }, [draftLayoutIntent]);
  useEffect(() => { clipRef.current = clip; }, [clip]);

  useLayoutEffect(() => {
    refreshContentInset();
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(() => refreshContentInset());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [sourceSize.width, sourceSize.height, clip?.width, clip?.height, url]);

  const persist = (next: TestKeyframe[]) => {
    keyframesRef.current = next;
    setKeyframes(next);
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaveState("saving");
      void testDataService.replaceAnnotations(clipId, next).then((result) => {
        setClip((current) => current ? { ...current, annotationRevision: result.annotationRevision } : current);
        setSaveState("saved");
      }).catch((error) => {
        setSaveState("error");
        appToast.error("Could not save annotations", String(error));
      });
    }, 450);
  };

  const buildKeyframe = (
    time: number,
    targets: TestTarget[],
    layoutIntent: TestLayoutIntent,
    frames: TestKeyframe[],
  ): TestKeyframe => {
    const timestampUs = Math.min(
      Math.round((clip?.duration ?? time) * 1_000_000),
      Math.max(0, Math.round(time * 1_000_000)),
    );
    const existing = frames.find((frame) => Math.abs(frame.timestampUs - timestampUs) <= KEYFRAME_TIME_TOLERANCE_US);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      timestampUs,
      layoutIntent,
      targets: targets.map((target, index) => ({
        ...target,
        id: existing?.targets[index]?.id ?? crypto.randomUUID(),
        slot: index as 0 | 1,
      })),
    };
  };

  const commitKeyframeAtTime = (
    time: number,
    targets: TestTarget[],
    layoutIntent: TestLayoutIntent,
  ) => {
    if (!clip) return;
    const frames = keyframesRef.current;
    const frame = buildKeyframe(time, targets, layoutIntent, frames);
    const next = normalizeKeyframes([
      ...frames.filter((item) => item.id !== frame.id && Math.abs(item.timestampUs - frame.timestampUs) > KEYFRAME_TIME_TOLERANCE_US),
      frame,
    ], sourceWidth, sourceHeight);
    persist(next);
    setGeometryChanged(false);
  };

  const syncDraftToTime = (time: number) => {
    if (geometryChanged) {
      commitKeyframeAtTime(
        currentTimeRef.current,
        draftTargetsRef.current,
        draftLayoutIntentRef.current,
      );
    }
    const frames = keyframesRef.current;
    const currentClip = clipRef.current;
    const timestampUs = Math.round(time * 1_000_000);
    const intent = frames.length ? evaluateLayoutIntent(frames, timestampUs) : "crop";
    setCurrentTime(time);
    setGeometryChanged(false);
    setDraftLayoutIntent(intent);
    draftLayoutIntentRef.current = intent;
    const targets = frames.length
      ? evaluateGroundTruth(frames, timestampUs, sourceWidth, sourceHeight)
      : currentClip ? [freshTarget(0, currentClip)] : [];
    draftTargetsRef.current = targets;
    setDraftTargets(targets);
  };

  const addOrUpdateKeyframe = () => {
    commitKeyframeAtTime(currentTime, draftTargets, draftLayoutIntent);
  };

  const deleteNearestKeyframe = () => {
    if (!keyframes.length) return;
    const nearest = [...keyframes].sort((a, b) => Math.abs(a.timestampUs / 1e6 - currentTime) - Math.abs(b.timestampUs / 1e6 - currentTime))[0]!;
    persist(keyframes.filter((frame) => frame.id !== nearest.id));
    setGeometryChanged(false);
  };

  const startPointer = (event: React.PointerEvent, slot: 0 | 1, mode: "move" | "resize") => {
    event.preventDefault();
    event.stopPropagation();
    const currentClip = clipRef.current;
    if (!currentClip || !stageRef.current) return;
    const pointerId = event.pointerId;
    const isContain = draftLayoutIntentRef.current === "contain";
    const stageRect = stageRef.current.getBoundingClientRect();
    const inset = videoContentInset(
      stageRect.width,
      stageRect.height,
      sourceSize.width || currentClip.width,
      sourceSize.height || currentClip.height,
    );
    const toSource = (clientX: number, clientY: number) => stageNormToSourceNorm(
      (clientX - stageRect.left) / stageRect.width,
      (clientY - stageRect.top) / stageRect.height,
      inset,
    );
    const startSource = toSource(event.clientX, event.clientY);
    const startTarget = draftTargetsRef.current.find((target) => target.slot === slot);
    if (!startTarget) return;
    const grabOffset = mode === "move"
      ? { x: startSource.x - startTarget.x, y: startSource.y - startTarget.y }
      : null;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      const moveInset = videoContentInset(
        rect.width,
        rect.height,
        sourceSize.width || currentClip.width,
        sourceSize.height || currentClip.height,
      );
      const pointer = stageNormToSourceNorm(
        (pointerEvent.clientX - rect.left) / rect.width,
        (pointerEvent.clientY - rect.top) / rect.height,
        moveInset,
      );
      const sw = sourceSize.width || currentClip.width;
      const sh = sourceSize.height || currentClip.height;
      setDraftTargets((current) => {
        const next = current.map((target) => {
          if (target.slot !== slot) return target;
          if (isContain) {
            if (mode === "move" && grabOffset) {
              return {
                ...target,
                ...clampTargetRect({
                  ...target,
                  x: pointer.x - grabOffset.x,
                  y: pointer.y - grabOffset.y,
                }),
              } as TestTarget;
            }
            return { ...target, ...resizeTargetFree(target, pointer) } as TestTarget;
          }
          if (mode === "move" && grabOffset) {
            return finalizeTargetRect({
              ...target,
              x: pointer.x - grabOffset.x,
              y: pointer.y - grabOffset.y,
            }, sw, sh) as TestTarget;
          }
          return {
            ...target,
            ...resizeTargetFromCorner(target, pointer, sw, sh),
          } as TestTarget;
        });
        draftTargetsRef.current = next;
        return next;
      });
      setGeometryChanged(true);
    };
    const up = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      commitKeyframeAtTime(
        currentTimeRef.current,
        draftTargetsRef.current,
        draftLayoutIntentRef.current,
      );
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const selectedTimestamp = useMemo(() => {
    const exact = keyframes.find((frame) => Math.abs(frame.timestampUs / 1e6 - currentTime) < 0.002);
    return exact?.timestampUs ?? null;
  }, [currentTime, keyframes]);

  const helperText = draftLayoutIntent === "contain"
    ? "Drag to pan, corner handle to resize freely. Shows what should be visible (contain)."
    : "Drag to pan, corner handle to zoom. Boxes are always 9:16.";

  if (loading) return <ClipperLayout><AppLoader /></ClipperLayout>;
  if (!clip || !url) return <ClipperLayout><Text>Test clip was not found.</Text></ClipperLayout>;

  return (
    <ClipperLayout backLink={{ label: `Back to ${dataset?.name ?? "dataset"}`, onClick: () => navigate(`/clipper/tests/${datasetId}`) }}>
      <VStack align="stretch" gap={5} maxW="1100px" mx="auto">
        <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
          <Box>
            <Text fontSize="2xl" fontWeight="bold">{clip.name}</Text>
            <Text color={theme.text.muted}>{helperText}</Text>
          </Box>
          <HStack><Save size={15} /><Text fontSize="sm" color={saveState === "error" ? "red.300" : theme.text.muted}>{saveState}</Text></HStack>
        </HStack>

        <Box
          ref={stageRef}
          position="relative"
          bg="black"
          borderRadius="2xl"
          overflow="hidden"
          width="100%"
          aspectRatio={`${sourceWidth || clip.width} / ${sourceHeight || clip.height}`}
          maxH="68vh"
          mx="auto"
          userSelect="none"
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (!video.videoWidth || !video.videoHeight) return;
              setSourceSize({ width: video.videoWidth, height: video.videoHeight });
            }}
            onTimeUpdate={(event) => {
              if (!geometryChanged) syncDraftToTime(event.currentTarget.currentTime);
              else setCurrentTime(event.currentTarget.currentTime);
            }}
            onSeeked={(event) => syncDraftToTime(event.currentTarget.currentTime)}
          />
          {draftTargets.map((target) => {
            const layout = targetToStagePercent(target, contentInset);
            const color = draftLayoutIntent === "contain" ? CONTAIN_COLOR : TARGET_COLORS[target.slot];
            return (
            <Box
              key={target.slot}
              position="absolute"
              left={`${layout.left}%`}
              top={`${layout.top}%`}
              width={`${layout.width}%`}
              height={`${layout.height}%`}
              border="3px solid"
              borderColor={color}
              cursor="move"
              boxShadow="0 0 0 1px rgba(0,0,0,.75), 0 0 16px rgba(0,0,0,.35)"
              onPointerDown={(event) => startPointer(event, target.slot, "move")}
            >
              <Box position="absolute" left="50%" top="50%" width="18px" height="2px" bg={color} transform="translate(-50%,-50%)" />
              <Box position="absolute" left="50%" top="50%" width="2px" height="18px" bg={color} transform="translate(-50%,-50%)" />
              <Box
                position="absolute"
                right="-7px"
                bottom="-7px"
                width="14px"
                height="14px"
                borderRadius="full"
                bg="white"
                border="2px solid"
                borderColor={color}
                cursor="nwse-resize"
                onPointerDown={(event) => startPointer(event, target.slot, "resize")}
              />
            </Box>
            );
          })}
        </Box>

        <HStack gap={3}>
          <Button size="sm" onClick={() => videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause()}>{videoRef.current?.paused === false ? "Pause" : "Play"}</Button>
          <Text minW="70px">{formatTime(currentTime)}</Text>
          <Slider.Root flex="1" min={0} max={clip.duration} step={1 / Math.max(1, clip.frameRate)} value={[currentTime]} onValueChange={(details) => {
            const time = details.value[0] ?? 0;
            if (videoRef.current) videoRef.current.currentTime = time;
            syncDraftToTime(time);
          }}><Slider.Control><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb index={0} /></Slider.Control></Slider.Root>
        </HStack>
        <Box position="relative" h="18px" mx="75px">
          {keyframes.map((frame) => {
            const isContain = frame.layoutIntent === "contain";
            return (
              <Box
                key={frame.id}
                as="button"
                title={formatTime(frame.timestampUs / 1e6)}
                position="absolute"
                left={`${(frame.timestampUs / 1e6 / clip.duration) * 100}%`}
                transform="translateX(-50%)"
                w={isContain ? "10px" : "8px"}
                h={isContain ? "10px" : "14px"}
                borderRadius={isContain ? "sm" : "full"}
                bg={isContain ? CONTAIN_COLOR : (frame.targets.length === 2 ? TARGET_COLORS[1] : TARGET_COLORS[0])}
                onClick={() => {
                  const time = frame.timestampUs / 1e6;
                  if (videoRef.current) videoRef.current.currentTime = time;
                  syncDraftToTime(time);
                }}
              />
            );
          })}
        </Box>

        <HStack gap={2} flexWrap="wrap">
          <OutlinedActionButton startIcon={<Plus size={16} />} onClick={addOrUpdateKeyframe}>
            {selectedTimestamp != null ? "Update keyframe" : "Add keyframe"}
          </OutlinedActionButton>
          {draftLayoutIntent === "contain" ? (
            <OutlinedActionButton
              startIcon={<Maximize2 size={16} />}
              onClick={() => {
                const nextTargets = [freshTarget(0, clip)];
                setDraftLayoutIntent("crop");
                draftLayoutIntentRef.current = "crop";
                setDraftTargets(nextTargets);
                draftTargetsRef.current = nextTargets;
                commitKeyframeAtTime(currentTime, nextTargets, "crop");
              }}
            >
              Back to crop targets
            </OutlinedActionButton>
          ) : draftTargets.length === 1 ? (
            <>
              <OutlinedActionButton
                startIcon={<Users size={16} />}
                onClick={() => {
                  const center = targetCenter(draftTargets[0]!);
                  const next = [...draftTargets, freshTarget(1, clip, Math.min(0.85, center.x + draftTargets[0]!.width * 0.6), center.y)];
                  setDraftTargets(next);
                  commitKeyframeAtTime(currentTime, next, "crop");
                }}
              >
                Add second target
              </OutlinedActionButton>
              <OutlinedActionButton
                startIcon={<Maximize2 size={16} />}
                onClick={() => {
                  const nextTargets = [freshContainTarget(clip)];
                  setDraftLayoutIntent("contain");
                  draftLayoutIntentRef.current = "contain";
                  setDraftTargets(nextTargets);
                  draftTargetsRef.current = nextTargets;
                  commitKeyframeAtTime(currentTime, nextTargets, "contain");
                }}
              >
                Contain viewport
              </OutlinedActionButton>
            </>
          ) : (
            <OutlinedActionButton
              startIcon={<Users size={16} />}
              onClick={() => {
                const next = draftTargets.slice(0, 1);
                setDraftTargets(next);
                commitKeyframeAtTime(currentTime, next, "crop");
              }}
            >
              Remove second target
            </OutlinedActionButton>
          )}
          <OutlinedActionButton
            tone="danger"
            startIcon={<Trash2 size={16} />}
            disabled={!keyframes.length}
            onClick={deleteNearestKeyframe}
          >
            Delete nearest keyframe
          </OutlinedActionButton>
        </HStack>
        <Text fontSize="sm" color={theme.text.muted}>
          Dragging a target saves a keyframe at the playhead. Between keyframes, positions interpolate linearly; target count and layout mode change only on keyframes. The first and last values are held to clip boundaries.
        </Text>
      </VStack>
    </ClipperLayout>
  );
}
