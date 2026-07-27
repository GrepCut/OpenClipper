import { Box, Spinner, Text } from "@chakra-ui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { rememberAuthReturnPath } from "../../shared/auth/auth-return-path.util";
import { useTheme } from "../../theme";
import { clipperTheme } from "../clipper/shared/theme.util";

export function AccountHeaderAction() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, hasTriedInit, isLoading, isLoggingOut, logout } = useAuth();
  const checking = !hasTriedInit || isLoading || isLoggingOut;

  const common = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    px: 2.5,
    py: 1.5,
    borderRadius: "lg",
    fontSize: "sm",
    color: theme.text.muted,
  } as const;

  if (checking) {
    return (
      <Box {...common} cursor="wait" aria-label="Checking account">
        <Spinner size="xs" borderWidth="2px" />
        <Text display={{ base: "none", md: "block" }}>Account…</Text>
      </Box>
    );
  }

  if (!user || !isAuthenticated) {
    if (location.pathname === "/auth") {
      return null;
    }

    return (
      <Box
        as="button"
        display="inline-flex"
        alignItems="center"
        gap={1.5}
        px={3}
        py={1}
        borderRadius="full"
        fontSize="xs"
        fontWeight="700"
        letterSpacing="-0.01em"
        color="white"
        bg={clipperTheme.accent}
        cursor="pointer"
        transition="all 0.2s ease"
        title="Log in to use integrations"
        onClick={() => {
          rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
          navigate("/auth");
        }}
        _hover={{ filter: "brightness(1.08)" }}
      >
        Log in
      </Box>
    );
  }

  return (
    <Box
      as="button"
      {...common}
      onClick={() => void logout()}
      _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
      title={`Sign out (${user.email})`}
    >
      <Text maxW="180px" truncate>
        {user.email || "Sign out"}
      </Text>
    </Box>
  );
}
