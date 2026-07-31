import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Copy } from "lucide-react";
import { useTheme } from "../../../theme";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";
import { AppLoader } from "../../../shared/components/app-loader.component";
import { OutlinedActionButton } from "../../../shared/components/buttons/outlined-action-button.component";
import { appToast } from "../../../shared/utils/toast.service";
import {
  getOpenClipperMcpHttpUrl,
  getOpenClipperMcpPath,
} from "../persistence/clipper-export-db-api.util";
import { buildMcpConfigSnippet } from "../persistence/clipper-export-social.util";
import {
  fetchOpenClipperMcpToolsCatalog,
  type McpToolCatalogEntry,
  type McpToolsCatalog,
} from "../persistence/clipper-mcp-catalog-api.util";

async function copyToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    appToast.success(successMessage);
  } catch {
    appToast.error("Clipboard copy failed");
  }
}

function formatExample(example: unknown): string {
  if (example === undefined || example === null) {
    return "No example defined";
  }
  return JSON.stringify(example, null, 2);
}

interface McpToolCardProps {
  tool: McpToolCatalogEntry;
  defaultExpanded: boolean;
}

function McpToolCard({ tool, defaultExpanded }: McpToolCardProps) {
  const { theme, mode } = useTheme();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cardBg = mode === "dark" ? theme.background.card : "gray.50";

  return (
    <Box bg={cardBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
      <VStack align="stretch" gap={3}>
        <HStack justify="space-between" align="start" gap={4}>
          <VStack align="start" gap={1} minW={0} flex={1}>
            <Text fontFamily="mono" fontWeight="semibold" color={theme.text.primary}>
              {tool.name}
            </Text>
            {tool.description ? (
              <Text fontSize="sm" color={theme.text.muted} lineHeight="1.6">
                {tool.description}
              </Text>
            ) : null}
          </VStack>
          <OutlinedActionButton onClick={() => setExpanded((value) => !value)} whiteSpace="nowrap">
            {expanded ? "Collapse" : "Expand"}
          </OutlinedActionButton>
        </HStack>

        {expanded ? (
          <VStack align="stretch" gap={4}>
            <VStack align="stretch" gap={2}>
              <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                Example request
              </Text>
              <Box
                as="pre"
                p={3}
                borderRadius="lg"
                bg={theme.surface.subtle}
                border="1px solid"
                borderColor={theme.border.primary}
                fontFamily="mono"
                fontSize="xs"
                whiteSpace="pre-wrap"
                overflowX="auto"
                color={theme.text.primary}
              >
                {formatExample(tool.inputExample)}
              </Box>
            </VStack>

            <VStack align="stretch" gap={2}>
              <Text fontSize="sm" fontWeight="semibold" color={theme.text.primary}>
                Example response
              </Text>
              <Box
                as="pre"
                p={3}
                borderRadius="lg"
                bg={theme.surface.subtle}
                border="1px solid"
                borderColor={theme.border.primary}
                fontFamily="mono"
                fontSize="xs"
                whiteSpace="pre-wrap"
                overflowX="auto"
                color={theme.text.primary}
              >
                {formatExample(tool.outputExample)}
              </Box>
            </VStack>
          </VStack>
        ) : null}
      </VStack>
    </Box>
  );
}

export function ClipperHomeMcpView() {
  const { theme, mode } = useTheme();
  const panelBg = mode === "dark" ? theme.background.card : "gray.50";
  const [catalog, setCatalog] = useState<McpToolsCatalog | null>(null);
  const [httpUrl, setHttpUrl] = useState<string>("");
  const [stdioPath, setStdioPath] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [catalogResult, url, path] = await Promise.all([
          fetchOpenClipperMcpToolsCatalog(),
          getOpenClipperMcpHttpUrl(),
          getOpenClipperMcpPath(),
        ]);
        if (cancelled) return;
        setCatalog(catalogResult);
        setHttpUrl(url);
        setStdioPath(path);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load MCP catalog");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const configSnippet = buildMcpConfigSnippet({ httpUrl: httpUrl || undefined, stdioPath: stdioPath || undefined });

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await copyToClipboard(value, `${label} copied`);
    } catch {
      appToast.error("Error", `Could not copy ${label.toLowerCase()}.`);
    }
  }, []);

  if (loading) {
    return (
      <CenteredLoader>
        <AppLoader />
      </CenteredLoader>
    );
  }

  if (error || !catalog) {
    return (
      <VStack align="stretch" gap={6}>
        <VStack align="start" gap={2} maxW="720px">
          <SecondaryMainTitle
            fontSize={{ base: "2xl", md: "3xl" }}
            fontWeight="semibold"
            letterSpacing="-0.03em"
          >
            MCP
          </SecondaryMainTitle>
        </VStack>
        <Text color={theme.text.muted}>{error ?? "MCP catalog unavailable."}</Text>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={10}>
      <VStack align="start" gap={2} maxW="720px">
        <SecondaryMainTitle
          fontSize={{ base: "2xl", md: "3xl" }}
          fontWeight="semibold"
          letterSpacing="-0.03em"
        >
          MCP
        </SecondaryMainTitle>
      </VStack>

      <Box bg={panelBg} borderRadius="2xl" p={{ base: 4, md: 5 }}>
        <VStack align="stretch" gap={4}>
          <Text fontWeight="semibold" color={theme.text.primary}>
            Connection
          </Text>
          <VStack align="stretch" gap={2}>
            <HStack justify="space-between" align="start" gap={3}>
              <VStack align="start" gap={0.5} minW={0}>
                <Text fontSize="sm" color={theme.text.muted}>
                  HTTP URL
                </Text>
                <Text fontFamily="mono" fontSize="sm" color={theme.text.primary} wordBreak="break-all">
                  {httpUrl || "Unavailable"}
                </Text>
              </VStack>
              {httpUrl ? (
                <OutlinedActionButton
                  startIcon={<Copy size={14} />}
                  onClick={() => void handleCopy(httpUrl, "HTTP URL")}
                  whiteSpace="nowrap"
                >
                  Copy
                </OutlinedActionButton>
              ) : null}
            </HStack>
            <HStack justify="space-between" align="start" gap={3}>
              <VStack align="start" gap={0.5} minW={0}>
                <Text fontSize="sm" color={theme.text.muted}>
                  Stdio binary
                </Text>
                <Text fontFamily="mono" fontSize="sm" color={theme.text.primary} wordBreak="break-all">
                  {stdioPath || "Unavailable"}
                </Text>
              </VStack>
              {stdioPath ? (
                <OutlinedActionButton
                  startIcon={<Copy size={14} />}
                  onClick={() => void handleCopy(stdioPath, "stdio path")}
                  whiteSpace="nowrap"
                >
                  Copy
                </OutlinedActionButton>
              ) : null}
            </HStack>
          </VStack>
          <VStack align="stretch" gap={2}>
            <HStack justify="space-between" align="center" gap={3}>
              <Text fontSize="sm" color={theme.text.muted}>
                Cursor config snippet
              </Text>
              <OutlinedActionButton
                startIcon={<Copy size={14} />}
                onClick={() => void handleCopy(configSnippet, "config snippet")}
                whiteSpace="nowrap"
              >
                Copy
              </OutlinedActionButton>
            </HStack>
            <Box
              as="pre"
              p={3}
              borderRadius="lg"
              bg={theme.surface.subtle}
              border="1px solid"
              borderColor={theme.border.primary}
              fontFamily="mono"
              fontSize="xs"
              whiteSpace="pre-wrap"
              overflowX="auto"
              color={theme.text.primary}
            >
              {configSnippet}
            </Box>
          </VStack>
        </VStack>
      </Box>

      <VStack align="stretch" gap={4}>
        <Text fontWeight="semibold" color={theme.text.primary}>
          Tools ({catalog.tools.length})
        </Text>
        {catalog.tools.map((tool, index) => (
          <McpToolCard key={tool.name} tool={tool} defaultExpanded={index === 0} />
        ))}
      </VStack>
    </VStack>
  );
}

function CenteredLoader({ children }: { children: ReactNode }) {
  return (
    <Box py={16} display="flex" justifyContent="center">
      {children}
    </Box>
  );
}
