import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Center,
  HStack,
  Text,
  VStack,
  useDisclosure,
} from "@chakra-ui/react";
import { FolderOpen, Plus } from "lucide-react";
import { appToast } from "../../../shared/utils/toast.service";
import { AppLoader } from "../../../shared/components/AppLoader";
import { projectsService, type Project } from "../../../services/projects.service";
import { ClipperLayout } from "../components/ClipperLayout";
import { ClipperProjectListRow } from "../components/ClipperProjectListRow";
import { CreateClipperProjectModal } from "./CreateClipperProjectModal";
import { ClipperTauriGate } from "./ClipperTauriGate";
import { openClipperProjectsDir } from "../persistence/project-data-files";
import { ProjectsPagination } from "../components/ProjectsPagination";
import { useTheme } from "../../../theme";
import { OutlinedActionButton } from "../../../shared/components/buttons/OutlinedActionButton";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import {
  ClipperGlobalSettingsDrawer,
  ClipperHomeHeaderActions,
} from "../components/ClipperGlobalSettingsDrawer";
import {
  loadClipperSettings,
  saveClipperSettings,
} from "../settings/settings-storage";
import type { ClipperSettings } from "../settings/settings";
import { useAuth } from "../../../shared/hooks/useAuth";

const ITEMS_PER_PAGE = 10;

export function ClipperHomePage() {
  const { theme } = useTheme();
  const { user, logout, isLoggingOut } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [defaultSettings, setDefaultSettings] = useState<ClipperSettings>(() =>
    loadClipperSettings(),
  );
  const { open: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const {
    open: isSettingsOpen,
    onOpen: onSettingsOpen,
    onClose: onSettingsClose,
  } = useDisclosure();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await projectsService.getAll(
        currentPage,
        ITEMS_PER_PAGE,
        "",
        "clipper",
        "updatedAt",
      );
      setProjects(response.data);
      setTotal(response.total);
    } catch (error) {
      console.error("Failed to load clipper projects", error);
    } finally {
      setLoading(false);
    }
  }, [currentPage]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleProjectDeleted = useCallback(async () => {
    if (projects.length === 1 && currentPage > 1) {
      setCurrentPage((page) => page - 1);
      return;
    }
    await loadProjects();
  }, [projects.length, currentPage, loadProjects]);

  const handleOpenProjectsDir = useCallback(async () => {
    try {
      await openClipperProjectsDir();
    } catch (error) {
      console.error("Failed to open clipper projects folder", error);
      appToast.error("Error", "Could not open the project data folder.");
    }
  }, []);

  const updateDefaultSettings = useCallback(
    (updater: ClipperSettings | ((prev: ClipperSettings) => ClipperSettings)) => {
      setDefaultSettings((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: ClipperSettings) => ClipperSettings)(prev)
            : updater;
        saveClipperSettings(next);
        return next;
      });
    },
    [],
  );

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  return (
    <ClipperTauriGate>
      <ClipperLayout
        headerActions={
          <ClipperHomeHeaderActions
            onOpenSettings={onSettingsOpen}
            onLogout={handleLogout}
            isLoggingOut={isLoggingOut}
            userEmail={user?.email}
          />
        }
      >
        <VStack align="stretch" gap={8}>
          <HStack justify="space-between" align="start" flexWrap="wrap" gap={4}>
            <VStack align="start" gap={2} maxW="640px">
              <SecondaryMainTitle
                fontSize={{ base: "2xl", md: "3xl" }}
                fontWeight="bold"
                color={theme.text.primary}
              >
                Turn long videos into platform-ready clips
              </SecondaryMainTitle>
              <Text color={theme.text.muted}>
                Create a Clipper project in the desktop app, upload your source video, and resume
                trimming, captions, and exports anytime.
              </Text>
            </VStack>
            <VStack align="stretch" gap={2} minW={{ base: "full", sm: "240px" }}>
              <OutlinedActionButton
                width="100%"
                justifyContent="flex-start"
                startIcon={<Plus size={16} />}
                onClick={onCreateOpen}
              >
                New clip project
              </OutlinedActionButton>
              <OutlinedActionButton
                width="100%"
                justifyContent="flex-start"
                startIcon={<FolderOpen size={16} />}
                onClick={() => void handleOpenProjectsDir()}
              >
                Open project data folder
              </OutlinedActionButton>
            </VStack>
          </HStack>

          {loading ? (
            <Center py={16}>
              <AppLoader />
            </Center>
          ) : projects.length === 0 ? (
            <Box
              p={10}
              borderRadius="2xl"
              border="1px dashed"
              borderColor={theme.dashboard.border}
              textAlign="center"
              bg={theme.background.card}
            >
              <Text color={theme.text.primary} fontWeight="semibold" mb={2}>
                No Clipper projects yet
              </Text>
              <Text color={theme.text.muted} mb={5}>
                Start by choosing where your source video will be stored, then upload and clip.
              </Text>
              <OutlinedActionButton
                width="100%"
                maxW="320px"
                mx="auto"
                justifyContent="center"
                startIcon={<Plus size={16} />}
                onClick={onCreateOpen}
              >
                Create your first clip project
              </OutlinedActionButton>
            </Box>
          ) : (
            <VStack align="stretch" gap={3}>
              {projects.map((project) => (
                <ClipperProjectListRow
                  key={project.id}
                  project={project}
                  onUpdated={() => void loadProjects()}
                  onDeleted={() => void handleProjectDeleted()}
                />
              ))}

              <ProjectsPagination
                currentPage={currentPage}
                totalItems={total}
                itemsPerPage={ITEMS_PER_PAGE}
                onPageChange={setCurrentPage}
              />
            </VStack>
          )}
        </VStack>

        <CreateClipperProjectModal
          isOpen={isCreateOpen}
          onClose={onCreateClose}
          onCreated={() => {
            setCurrentPage(1);
            void loadProjects();
          }}
        />

        <ClipperGlobalSettingsDrawer
          open={isSettingsOpen}
          onOpenChange={(open) => (open ? onSettingsOpen() : onSettingsClose())}
          settings={defaultSettings}
          onUpdateSettings={updateDefaultSettings}
        />
      </ClipperLayout>
    </ClipperTauriGate>
  );
}
