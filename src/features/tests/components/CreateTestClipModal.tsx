import { useEffect, useRef, useState } from "react";
import { Box, Button, Field, HStack, Input, Slider, Text, VStack } from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-dialog";
import { Film, FolderOpen } from "lucide-react";
import { StyledModal, StyledModalFooter } from "../../../shared/components/StyledModal";
import { appToast } from "../../../shared/utils/toast.service";
import { pathBackedFile } from "../../clipper/platform/native-source";
import { resolveFilePlayableUrl } from "../../clipper/persistence/tauri-media";
import { testDataService } from "../test-data.service";
import { TEST_MIN_CLIP_SECONDS, type TestClip } from "../types";

function timeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${Math.floor((seconds % 1) * 10)}`;
}

export function CreateTestClipModal(props: {
  open: boolean;
  datasetId: string;
  onClose: () => void;
  onCreated: (clip: TestClip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [name, setName] = useState("");
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (props.open) return;
    setSourcePath(null);
    setSourceName("");
    setUrl(null);
    setDuration(0);
    setName("");
    setRange([0, 0]);
  }, [props.open]);

  const choose = async () => {
    const path = await open({ multiple: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "m4v", "webm"] }] });
    if (!path || Array.isArray(path)) return;
    const fileName = path.split(/[\\/]/).pop() || "test-video.mp4";
    try {
      const playable = await resolveFilePlayableUrl(pathBackedFile(path, fileName));
      setSourcePath(path);
      setSourceName(fileName);
      setName(fileName.replace(/\.[^.]+$/, ""));
      setUrl(playable);
    } catch (error) {
      appToast.error("Could not open video", String(error));
    }
  };

  const changeRange = (next: number[]) => {
    let start = Math.max(0, next[0] ?? 0);
    let end = Math.min(duration, next[1] ?? duration);
    if (end - start < TEST_MIN_CLIP_SECONDS) {
      end = Math.min(duration, start + TEST_MIN_CLIP_SECONDS);
      start = Math.max(0, end - TEST_MIN_CLIP_SECONDS);
    }
    setRange([start, end]);
    if (videoRef.current) videoRef.current.currentTime = start;
  };

  const submit = async () => {
    if (!sourcePath || range[1] - range[0] < TEST_MIN_CLIP_SECONDS || loading) return;
    setLoading(true);
    try {
      const clip = await testDataService.createClip({
        datasetId: props.datasetId,
        name,
        sourcePath,
        originalFileName: sourceName,
        startTime: range[0],
        endTime: range[1],
      });
      appToast.success("Test clip stored", clip.name);
      props.onClose();
      props.onCreated(clip);
    } catch (error) {
      appToast.error("Could not create test clip", String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <StyledModal
      isOpen={props.open}
      onClose={props.onClose}
      title="Add a test clip"
      size="xl"
      isLoading={loading}
      footer={
        <StyledModalFooter
          onCancel={props.onClose}
          onSubmit={() => void submit()}
          submitText="Store test clip"
          submitDisabled={!sourcePath || duration < TEST_MIN_CLIP_SECONDS}
          isLoading={loading}
        />
      }
    >
      <VStack align="stretch" gap={4}>
        {!url ? (
          <Button onClick={() => void choose()} minH="150px" variant="outline" borderStyle="dashed">
            <VStack><FolderOpen /><Text>Choose a local source video</Text></VStack>
          </Button>
        ) : (
          <>
            <Box bg="black" borderRadius="xl" overflow="hidden" aspectRatio="16 / 9">
              <video
                ref={videoRef}
                src={url}
                controls
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                onLoadedMetadata={(event) => {
                  const value = event.currentTarget.duration;
                  setDuration(value);
                  setRange([0, value]);
                }}
              />
            </Box>
            <HStack justify="space-between">
              <Text fontSize="sm">{timeLabel(range[0])} – {timeLabel(range[1])}</Text>
              <Text fontSize="sm" fontWeight="bold">{(range[1] - range[0]).toFixed(1)} s</Text>
            </HStack>
            <Slider.Root min={0} max={Math.max(TEST_MIN_CLIP_SECONDS, duration)} step={0.05} value={range} onValueChange={(details) => changeRange(details.value)}>
              <Slider.Control><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb index={0} /><Slider.Thumb index={1} /></Slider.Control>
            </Slider.Root>
            <Button size="sm" variant="ghost" alignSelf="start" onClick={() => void choose()}><Film /> Choose another video</Button>
          </>
        )}
        <Field.Root required>
          <Field.Label>Clip name</Field.Label>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} />
        </Field.Root>
      </VStack>
    </StyledModal>
  );
}
