import { Text, VStack } from "@chakra-ui/react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { ClipperLayout } from "../../clipper/components/clipper-layout.component";
import { TestClipEditorSaveStatus, TestClipEditorStage } from "./test-clip-editor-stage.component";
import { useTestClipEditor } from "./use-test-clip-editor.hook";

export function TestClipEditorPage() {
  const { datasetId = "", clipId = "" } = useParams();
  const navigate = useNavigate();
  const editor = useTestClipEditor(datasetId, clipId);

  if (editor.loading) return <ClipperLayout><AppLoader /></ClipperLayout>;
  if (!editor.clip || !editor.url) return <ClipperLayout><Text>Test clip was not found.</Text></ClipperLayout>;

  return (
    <ClipperLayout backLink={{ label: `Back to ${editor.dataset?.name ?? "dataset"}`, onClick: () => navigate(`/clipper/tests/${datasetId}`) }}>
      <VStack align="stretch" gap={5} maxW="1100px" mx="auto">
        <TestClipEditorSaveStatus saveState={editor.saveState} />
        <TestClipEditorStage
          clip={editor.clip}
          url={editor.url}
          sourceWidth={editor.sourceWidth}
          sourceHeight={editor.sourceHeight}
          contentInset={editor.contentInset}
          draftTargets={editor.draftTargets}
          draftLayoutIntent={editor.draftLayoutIntent}
          currentTime={editor.currentTime}
          keyframes={editor.keyframes}
          geometryChanged={editor.geometryChanged}
          selectedTimestamp={editor.selectedTimestamp}
          videoRef={editor.videoRef}
          stageRef={editor.stageRef}
          onLoadedMetadata={(width, height) => editor.setSourceSize({ width, height })}
          onSyncDraftToTime={editor.syncDraftToTime}
          onSetCurrentTime={editor.setCurrentTime}
          onStartPointer={editor.startPointer}
          onAddOrUpdateKeyframe={editor.addOrUpdateKeyframe}
          onDeleteNearestKeyframe={editor.deleteNearestKeyframe}
          onSwitchToCrop={editor.switchToCrop}
          onAddSecondTarget={editor.addSecondTarget}
          onSwitchToContain={editor.switchToContain}
          onRemoveSecondTarget={editor.removeSecondTarget}
          hasKeyframes={editor.keyframes.length > 0}
        />
      </VStack>
    </ClipperLayout>
  );
}
