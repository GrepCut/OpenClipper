import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, HStack, Slider, Text, VStack } from "@chakra-ui/react";
import { Plus, Save, Trash2, Users } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLoader } from "../../../shared/components/AppLoader";
import { OutlinedActionButton } from "../../../shared/components/buttons/OutlinedActionButton";
import { appToast } from "../../../shared/utils/toast.service";
import { useTheme } from "../../../theme";
import { ClipperLayout } from "../../clipper/components/ClipperLayout";
import { evaluateGroundTruth, normalizeKeyframes } from "../benchmark/ground-truth";
import { testDataService } from "../test-data.service";
import type { TestClip, TestDataset, TestKeyframe, TestTarget } from "../types";

const TARGET_COLORS = ["#22D3EE", "#F472B6"];
const KEYFRAME_TIME_TOLERANCE_US = 1_000;

function formatTime(time: number): string {
  return `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}.${Math.floor((time % 1) * 10)}`;
}

function freshTarget(slot: 0 | 1, x: number, y = 0.5): TestTarget {
  return { id: crypto.randomUUID(), slot, x, y, radius: 0.09 };
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
  const draftTargetsRef = useRef<TestTarget[]>([freshTarget(0, 0.5)]);
  const [dataset, setDataset] = useState<TestDataset | null>(null);
  const [clip, setClip] = useState<TestClip | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [keyframes, setKeyframes] = useState<TestKeyframe[]>([]);
  const [draftTargets, setDraftTargets] = useState<TestTarget[]>([freshTarget(0, 0.5)]);
  const [currentTime, setCurrentTime] = useState(0);
  const [geometryChanged, setGeometryChanged] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [loading, setLoading] = useState(true);
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      testDataService.getDataset(datasetId),
      testDataService.getClip(clipId),
      testDataService.getAnnotations(clipId),
      testDataService.playableClip(clipId),
    ]).then(([loadedDataset, loadedClip, annotations, playable]) => {
      if (disposed) return;
      setDataset(loadedDataset);
      setClip(loadedClip);
      setKeyframes(normalizeKeyframes(annotations));
      setUrl(playable.url);
      setDraftTargets(annotations.length ? evaluateGroundTruth(annotations, 0) : [freshTarget(0, 0.5)]);
      initialized.current = true;
    }).catch((error) => appToast.error("Could not load test clip", String(error))).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [clipId, datasetId]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [url]);

  useEffect(() => {
    if (!initialized.current || !geometryChanged) return;
    setSaveState("dirty");
  }, [geometryChanged]);

  useEffect(() => { keyframesRef.current = keyframes; }, [keyframes]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { draftTargetsRef.current = draftTargets; }, [draftTargets]);

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

  const buildKeyframe = (time: number, targets: TestTarget[], frames: TestKeyframe[]): TestKeyframe => {
    const timestampUs = Math.min(
      Math.round((clip?.duration ?? time) * 1_000_000),
      Math.max(0, Math.round(time * 1_000_000)),
    );
    const existing = frames.find((frame) => Math.abs(frame.timestampUs - timestampUs) <= KEYFRAME_TIME_TOLERANCE_US);
    return {
      id: existing?.id ?? crypto.randomUUID(),
      timestampUs,
      targets: targets.map((target, index) => ({
        ...target,
        id: existing?.targets[index]?.id ?? crypto.randomUUID(),
        slot: index as 0 | 1,
      })),
    };
  };

  const commitKeyframeAtTime = (time: number, targets: TestTarget[]) => {
    if (!clip) return;
    const frames = keyframesRef.current;
    const frame = buildKeyframe(time, targets, frames);
    const next = normalizeKeyframes([
      ...frames.filter((item) => item.id !== frame.id && Math.abs(item.timestampUs - frame.timestampUs) > KEYFRAME_TIME_TOLERANCE_US),
      frame,
    ]);
    persist(next);
    setGeometryChanged(false);
  };

  const syncDraftToTime = (time: number) => {
    if (geometryChanged) {
      commitKeyframeAtTime(currentTimeRef.current, draftTargetsRef.current);
    }
    const frames = keyframesRef.current;
    setCurrentTime(time);
    setGeometryChanged(false);
    setDraftTargets(frames.length
      ? evaluateGroundTruth(frames, Math.round(time * 1_000_000))
      : [freshTarget(0, 0.5)]);
  };

  const addOrUpdateKeyframe = () => {
    commitKeyframeAtTime(currentTime, draftTargets);
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
    const pointerId = event.pointerId;
    const move = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== pointerId || !stageRef.current) return;
      const rect = stageRef.current.getBoundingClientRect();
      setDraftTargets((current) => {
        const next = current.map((target) => {
          if (target.slot !== slot) return target;
          if (mode === "move") {
            return {
              ...target,
              x: Math.max(0, Math.min(1, (pointerEvent.clientX - rect.left) / rect.width)),
              y: Math.max(0, Math.min(1, (pointerEvent.clientY - rect.top) / rect.height)),
            };
          }
          const centerX = rect.left + target.x * rect.width;
          const centerY = rect.top + target.y * rect.height;
          return { ...target, radius: Math.max(0.005, Math.hypot(pointerEvent.clientX - centerX, pointerEvent.clientY - centerY) / Math.min(rect.width, rect.height)) };
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
      commitKeyframeAtTime(currentTimeRef.current, draftTargetsRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const selectedTimestamp = useMemo(() => {
    const exact = keyframes.find((frame) => Math.abs(frame.timestampUs / 1e6 - currentTime) < 0.002);
    return exact?.timestampUs ?? null;
  }, [currentTime, keyframes]);

  if (loading) return <ClipperLayout><AppLoader /></ClipperLayout>;
  if (!clip || !url) return <ClipperLayout><Text>Test clip was not found.</Text></ClipperLayout>;

  return (
    <ClipperLayout backLink={{ label: `Back to ${dataset?.name ?? "dataset"}`, onClick: () => navigate(`/clipper/tests/${datasetId}`) }}>
      <VStack align="stretch" gap={5} maxW="1100px" mx="auto">
        <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
          <Box>
            <Text fontSize="2xl" fontWeight="bold">{clip.name}</Text>
            <Text color={theme.text.muted}>Drag a target to annotate the current frame. Scrubbing only previews interpolation between keyframes.</Text>
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
          aspectRatio={`${clip.width} / ${clip.height}`}
          maxH="68vh"
          mx="auto"
          userSelect="none"
        >
          <video
            ref={videoRef}
            src={url}
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            onTimeUpdate={(event) => {
              if (!geometryChanged) syncDraftToTime(event.currentTarget.currentTime);
              else setCurrentTime(event.currentTarget.currentTime);
            }}
            onSeeked={(event) => syncDraftToTime(event.currentTarget.currentTime)}
          />
          {draftTargets.map((target) => {
            const diameter = target.radius * 2 * Math.min(stageSize.width, stageSize.height);
            return (
              <Box
                key={target.slot}
                position="absolute"
                left={`${target.x * 100}%`}
                top={`${target.y * 100}%`}
                width={`${diameter}px`}
                height={`${diameter}px`}
                transform="translate(-50%, -50%)"
                border="3px solid"
                borderColor={TARGET_COLORS[target.slot]}
                borderRadius="full"
                cursor="move"
                boxShadow="0 0 0 1px rgba(0,0,0,.75), 0 0 16px rgba(0,0,0,.35)"
                onPointerDown={(event) => startPointer(event, target.slot, "move")}
              >
                <Box position="absolute" left="50%" top="50%" width="18px" height="2px" bg={TARGET_COLORS[target.slot]} transform="translate(-50%,-50%)" />
                <Box position="absolute" left="50%" top="50%" width="2px" height="18px" bg={TARGET_COLORS[target.slot]} transform="translate(-50%,-50%)" />
                <Box
                  position="absolute"
                  right="-7px"
                  bottom="-7px"
                  width="14px"
                  height="14px"
                  borderRadius="full"
                  bg="white"
                  border="2px solid"
                  borderColor={TARGET_COLORS[target.slot]}
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
          {keyframes.map((frame) => <Box key={frame.id} as="button" title={formatTime(frame.timestampUs / 1e6)} position="absolute" left={`${(frame.timestampUs / 1e6 / clip.duration) * 100}%`} transform="translateX(-50%)" w="8px" h="14px" borderRadius="full" bg={frame.targets.length === 2 ? TARGET_COLORS[1] : TARGET_COLORS[0]} onClick={() => {
            const time = frame.timestampUs / 1e6;
            if (videoRef.current) videoRef.current.currentTime = time;
            syncDraftToTime(time);
          }} />)}
        </Box>

        <HStack gap={2} flexWrap="wrap">
          <OutlinedActionButton startIcon={<Plus size={16} />} onClick={addOrUpdateKeyframe}>
            {selectedTimestamp != null ? "Update keyframe" : "Add keyframe"}
          </OutlinedActionButton>
          {draftTargets.length === 1 ? (
            <OutlinedActionButton
              startIcon={<Users size={16} />}
              onClick={() => {
                const next = [...draftTargets, freshTarget(1, Math.min(0.85, draftTargets[0]!.x + 0.25), draftTargets[0]!.y)];
                setDraftTargets(next);
                commitKeyframeAtTime(currentTime, next);
              }}
            >
              Add second target
            </OutlinedActionButton>
          ) : (
            <OutlinedActionButton
              startIcon={<Users size={16} />}
              onClick={() => {
                const next = draftTargets.slice(0, 1);
                setDraftTargets(next);
                commitKeyframeAtTime(currentTime, next);
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
          Dragging a target saves a keyframe at the playhead. Between keyframes, positions interpolate linearly; target count changes only on keyframes. The first and last values are held to clip boundaries.
        </Text>
      </VStack>
    </ClipperLayout>
  );
}
