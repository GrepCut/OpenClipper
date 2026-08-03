import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import type { User } from "../../../shared/types/auth.types";
import { useTheme } from "../../../theme";
import { clipperTheme } from "../../clipper/shared/theme.util";

function getUserDisplayName(user: User): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email;
}

export function AccountHeaderAction() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, hasTriedInit, isLoggingOut, logout } = useAuth();

  if (!hasTriedInit) {
    return (
      <Box
        display="flex"
        alignItems="center"
        gap={2}
        px={2.5}
        py={1.5}
        aria-label="Checking account"
        aria-busy="true"
      >
        <Spinner size="xs" borderWidth="2px" color={theme.text.muted} />
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

  const displayName = getUserDisplayName(user);

  return (
    <HStack gap={2} align="center" flexShrink={0}>
      <Text
        fontSize="sm"
        fontWeight="medium"
        color={theme.text.primary}
        maxW="160px"
        truncate
        title={user.email}
      >
        {displayName}
      </Text>
      <Box
        as="button"
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        gap={1.5}
        minW="72px"
        px={2.5}
        py={1}
        borderRadius="full"
        fontSize="xs"
        fontWeight="600"
        color={theme.text.muted}
        border="1px solid"
        borderColor={theme.dashboard.border}
        bg="transparent"
        cursor={isLoggingOut ? "wait" : "pointer"}
        disabled={isLoggingOut}
        aria-busy={isLoggingOut}
        title={`Sign out (${user.email})`}
        onClick={() => {
          if (isLoggingOut) return;
          void logout();
        }}
        transition="all 0.2s ease"
        _hover={
          isLoggingOut
            ? undefined
            : {
                bg: theme.surface.hover,
                color: theme.text.primary,
                borderColor: theme.text.muted,
              }
        }
      >
        {isLoggingOut ? <Spinner size="xs" borderWidth="2px" /> : "Log out"}
      </Box>
    </HStack>
  );
}
