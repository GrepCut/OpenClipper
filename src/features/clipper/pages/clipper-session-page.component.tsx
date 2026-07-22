import { useEffect, useState } from "react";

import { Box, Button, Center, Text, VStack } from "@chakra-ui/react";

import { useNavigate, useParams } from "react-router-dom";

import { projectsService, type Project } from "../../../services/projects.service";

import { useAuth } from "../../../shared/hooks/use-auth.hook";

import { ClipperLayout } from "../components/clipper-layout.component";
import { ClipperProjectLoadingPanel } from "../components/clipper-project-loading-panel.component";

import { ClipperSessionView } from "./clipper-session-view.component";

import { ClipperTauriGate } from "./clipper-tauri-gate.component";

import { useClipperProjectLoader } from "../hooks/use-clipper-project-loader.hook";
import { useClipperUi } from "../shared/use-clipper-ui.hook";
import {
  simpleLoadingStatus,
  type ClipperLoadingStatus,
} from "../shared/loading-status.util";



function ClipperSessionContent({

  project,

  token,

}: {

  project: Project;

  token: string | null;

}) {

  const navigate = useNavigate();
  const { theme, errorPanel } = useClipperUi();

  const loader = useClipperProjectLoader(project, token);



  if (loader.phase === "loading") {

    return (

      <ClipperLayout>

        <Center py={20}>

          <ClipperProjectLoadingPanel status={loader.loadingStatus} />

        </Center>

      </ClipperLayout>

    );

  }



  if (loader.phase === "error") {

    return (

      <ClipperLayout>

        <Box

          p={8}

          borderRadius="2xl"

          maxW="560px"

          mx="auto"

          {...errorPanel}

        >

          <Text color={theme.status.danger} fontWeight="semibold" mb={2}>

            Could not open this clip project

          </Text>

          <Text color={theme.text.muted} mb={5}>

            {loader.error ?? "Unknown error"}

          </Text>

          <Button onClick={() => navigate("/clipper")} borderRadius="2xl">

            Back to clips

          </Button>

        </Box>

      </ClipperLayout>

    );

  }



  return <ClipperSessionView project={project} token={token} loaded={loader.loaded} />;

}



export function ClipperSessionPage() {

  const { projectId } = useParams<{ projectId: string }>();

  const navigate = useNavigate();
  const { theme } = useClipperUi();

  const { token } = useAuth();

  const [project, setProject] = useState<Project | null>(null);

  const [projectError, setProjectError] = useState<string | null>(null);

  const [loadingProject, setLoadingProject] = useState(true);

  const [fetchLoadingStatus, setFetchLoadingStatus] = useState<ClipperLoadingStatus>(
    simpleLoadingStatus("Opening local project"),
  );



  useEffect(() => {

    if (!projectId) {

      navigate("/clipper", { replace: true });

      return;

    }



    let cancelled = false;

    setLoadingProject(true);

    setFetchLoadingStatus(simpleLoadingStatus("Fetching project from server"));



    void projectsService

      .getById(projectId)

      .then((loadedProject) => {

        if (cancelled) return;

        if (loadedProject.projectType !== "clipper") {

          setProjectError("This project is not a Clipper session.");

          setProject(null);

          return;

        }

        setProject(loadedProject);

        setProjectError(null);

      })

      .catch((error) => {

        if (cancelled) return;

        setProjectError(error instanceof Error ? error.message : "Failed to load project.");

      })

      .finally(() => {

        if (!cancelled) setLoadingProject(false);

      });



    return () => {

      cancelled = true;

    };

  }, [navigate, projectId]);



  if (!projectId) return null;



  if (loadingProject || !project) {

    return (

      <ClipperTauriGate>

        <ClipperLayout>

          <Center py={20}>

            {projectError ? (

              <VStack gap={4}>

                <Text color={theme.status.danger}>{projectError}</Text>

                <Button onClick={() => navigate("/clipper")} borderRadius="2xl">

                  Back to clips

                </Button>

              </VStack>

            ) : (

              <ClipperProjectLoadingPanel status={fetchLoadingStatus} />

            )}

          </Center>

        </ClipperLayout>

      </ClipperTauriGate>

    );

  }



  return (

    <ClipperTauriGate>

      <ClipperSessionContent project={project} token={token} />

    </ClipperTauriGate>

  );

}
