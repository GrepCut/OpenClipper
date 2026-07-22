import { Box, Button, HStack, Slider, Text, VStack } from "@chakra-ui/react";
import { Maximize2, Plus, Save, Trash2, Users } from "lucide-react";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { useTheme } from "../../../theme";
import { targetToStagePercent } from "../benchmark/target-geometry.util";
import type { TestClip, TestKeyframe, TestLayoutIntent, TestTarget } from "../test.types";
import type { NormalizedInset } from "../benchmark/target-geometry.util";
import {
  CONTAIN_COLOR,
  CONTAIN_HELPER_TEXT,
  CROP_HELPER_TEXT,
  formatTime,
  TARGET_COLORS,
} from "./test-clip-editor.util";

interface TestClipEditorStageProps {
  clip: TestClip;
  url: string;
  sourceWidth: number;
  sourceHeight: number;
  contentInset: NormalizedInset;
  draftTargets: TestTarget[];
  draftLayoutIntent: TestLayoutIntent;
  currentTime: number;
  keyframes: TestKeyframe[];
  geometryChanged: boolean;
  selectedTimestamp: number | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  onLoadedMetadata: (width: number, height: number) => void;
  onSyncDraftToTime: (time: number) => void;
  onSetCurrentTime: (time: number) => void;
  onStartPointer: (event: React.PointerEvent, slot: 0 | 1, mode: "move" | "resize") => void;
  onAddOrUpdateKeyframe: () => void;
  onDeleteNearestKeyframe: () => void;
  onSwitchToCrop: () => void;
  onAddSecondTarget: () => void;
  onSwitchToContain: () => void;
  onRemoveSecondTarget: () => void;
  hasKeyframes: boolean;
}

export function TestClipEditorStage({
  clip,
  url,
  sourceWidth,
  sourceHeight,
  contentInset,
  draftTargets,
  draftLayoutIntent,
  currentTime,
  keyframes,
  geometryChanged,
  selectedTimestamp,
  videoRef,
  stageRef,
  onLoadedMetadata,
  onSyncDraftToTime,
  onSetCurrentTime,
  onStartPointer,
  onAddOrUpdateKeyframe,
  onDeleteNearestKeyframe,
  onSwitchToCrop,
  onAddSecondTarget,
  onSwitchToContain,
  onRemoveSecondTarget,
  hasKeyframes,
}: TestClipEditorStageProps) {
  const { theme } = useTheme();
  const helperText = draftLayoutIntent === "contain" ? CONTAIN_HELPER_TEXT : CROP_HELPER_TEXT;

  return (
    <>
      <HStack justify="space-between" align="start" gap={4} flexWrap="wrap">
        <Box>
          <Text fontSize="2xl" fontWeight="bold">{clip.name}</Text>
          <Text color={theme.text.muted}>{helperText}</Text>
        </Box>
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
            onLoadedMetadata(video.videoWidth, video.videoHeight);
          }}
          onTimeUpdate={(event) => {
            if (!geometryChanged) onSyncDraftToTime(event.currentTarget.currentTime);
            else onSetCurrentTime(event.currentTarget.currentTime);
          }}
          onSeeked={(event) => onSyncDraftToTime(event.currentTarget.currentTime)}
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
              onPointerDown={(event) => onStartPointer(event, target.slot, "move")}
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
                onPointerDown={(event) => onStartPointer(event, target.slot, "resize")}
              />
            </Box>
          );
        })}
      </Box>

      <HStack gap={3} align="flex-start">
        <Button size="sm" onClick={() => videoRef.current?.paused ? void videoRef.current.play() : videoRef.current?.pause()}>
          {videoRef.current?.paused === false ? "Pause" : "Play"}
        </Button>
        <Text minW="70px">{formatTime(currentTime)}</Text>
        <VStack flex="1" gap={1} align="stretch">
          <Slider.Root flex="1" min={0} max={clip.duration} step={1 / Math.max(1, clip.frameRate)} value={[currentTime]} onValueChange={(details) => {
            const time = details.value[0] ?? 0;
            if (videoRef.current) videoRef.current.currentTime = time;
            onSyncDraftToTime(time);
          }}>
            <Slider.Control><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb index={0} /></Slider.Control>
          </Slider.Root>
          <Box position="relative" h="18px" w="100%">
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
                    onSyncDraftToTime(time);
                  }}
                />
              );
            })}
          </Box>
        </VStack>
      </HStack>

      <HStack gap={2} flexWrap="wrap">
        <OutlinedActionButton startIcon={<Plus size={16} />} onClick={onAddOrUpdateKeyframe}>
          {selectedTimestamp != null ? "Update keyframe" : "Add keyframe"}
        </OutlinedActionButton>
        {draftLayoutIntent === "contain" ? (
          <OutlinedActionButton startIcon={<Maximize2 size={16} />} onClick={onSwitchToCrop}>
            Back to crop targets
          </OutlinedActionButton>
        ) : draftTargets.length === 1 ? (
          <>
            <OutlinedActionButton startIcon={<Users size={16} />} onClick={onAddSecondTarget}>
              Add second target
            </OutlinedActionButton>
            <OutlinedActionButton startIcon={<Maximize2 size={16} />} onClick={onSwitchToContain}>
              Contain viewport
            </OutlinedActionButton>
          </>
        ) : (
          <OutlinedActionButton startIcon={<Users size={16} />} onClick={onRemoveSecondTarget}>
            Remove second target
          </OutlinedActionButton>
        )}
        <OutlinedActionButton
          tone="danger"
          startIcon={<Trash2 size={16} />}
          disabled={!hasKeyframes}
          onClick={onDeleteNearestKeyframe}
        >
          Delete nearest keyframe
        </OutlinedActionButton>
      </HStack>
      <Text fontSize="sm" color={theme.text.muted}>
        Dragging a target saves a keyframe at the playhead. Between keyframes, positions interpolate linearly; target count and layout mode change only on keyframes. The first and last values are held to clip boundaries.
      </Text>
    </>
  );
}

export function TestClipEditorSaveStatus({
  saveState,
}: {
  saveState: "saved" | "saving" | "dirty" | "error";
}) {
  const { theme } = useTheme();
  return (
    <HStack>
      <Save size={15} />
      <Text fontSize="sm" color={saveState === "error" ? "red.300" : theme.text.muted}>{saveState}</Text>
    </HStack>
  );
}
