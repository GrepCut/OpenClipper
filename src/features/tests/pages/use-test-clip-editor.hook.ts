import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  evaluateGroundTruth,
  evaluateLayoutIntent,
  normalizeKeyframes,
} from "../benchmark/ground-truth.util";
import {
  videoContentInset,
  type NormalizedInset,
} from "../benchmark/target-geometry.util";
import { testDataService } from "../test-data.service";
import type { TestClip, TestDataset, TestKeyframe, TestLayoutIntent, TestTarget } from "../test.types";
import { appToast } from "../../../shared/utils/toast.service";
import {
  buildKeyframe,
  freshTarget,
  KEYFRAME_TIME_TOLERANCE_US,
} from "./test-clip-editor.util";
import { createTargetPointerHandlers } from "./test-clip-editor-pointer.util";
import { createLayoutTargetActions } from "./test-clip-editor-actions.util";

export function useTestClipEditor(datasetId: string, clipId: string) {
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
      const initialIntent = normalized.length ? evaluateLayoutIntent(normalized, 0) : "crop";
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

  const commitKeyframeAtTime = (
    time: number,
    targets: TestTarget[],
    layoutIntent: TestLayoutIntent,
  ) => {
    if (!clip) return;
    const frames = keyframesRef.current;
    const frame = buildKeyframe(time, targets, layoutIntent, frames, clip.duration);
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

  const startPointer = createTargetPointerHandlers({
    clipRef,
    stageRef,
    sourceSize,
    draftTargetsRef,
    draftLayoutIntentRef,
    currentTimeRef,
    setDraftTargets,
    setGeometryChanged,
    commitKeyframeAtTime,
  });

  const selectedTimestamp = useMemo(() => {
    const exact = keyframes.find((frame) => Math.abs(frame.timestampUs / 1e6 - currentTime) < 0.002);
    return exact?.timestampUs ?? null;
  }, [currentTime, keyframes]);

  const { switchToCrop, addSecondTarget, switchToContain, removeSecondTarget } = createLayoutTargetActions({
    clip,
    draftTargets,
    currentTime,
    setDraftLayoutIntent,
    draftLayoutIntentRef,
    setDraftTargets,
    draftTargetsRef,
    commitKeyframeAtTime,
  });

  return {
    videoRef,
    stageRef,
    dataset,
    clip,
    url,
    keyframes,
    draftTargets,
    draftLayoutIntent,
    currentTime,
    saveState,
    sourceWidth,
    sourceHeight,
    contentInset,
    loading,
    geometryChanged,
    selectedTimestamp,
    setSourceSize,
    syncDraftToTime,
    setCurrentTime,
    startPointer,
    addOrUpdateKeyframe,
    deleteNearestKeyframe,
    switchToCrop,
    addSecondTarget,
    switchToContain,
    removeSecondTarget,
  };
}
