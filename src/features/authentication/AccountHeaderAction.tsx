import { Box, Spinner, Text } from "@chakra-ui/react";
import { LogIn, LogOut } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/hooks/useAuth";
import { rememberAuthReturnPath } from "../../shared/auth/auth-return-path";
import { useTheme } from "../../theme";

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
    return (
      <Box
        as="button"
        type="button"
        {...common}
        onClick={() => {
          rememberAuthReturnPath(`${location.pathname}${location.search}${location.hash}`);
          navigate("/auth");
        }}
        _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
        title="Log in to use integrations"
      >
        <LogIn size={16} />
        <Text display={{ base: "none", md: "block" }}>Log in</Text>
      </Box>
    );
  }

  return (
    <Box
      as="button"
      type="button"
      {...common}
      onClick={() => void logout()}
      _hover={{ bg: theme.surface.hover, color: theme.text.primary }}
      title={`Sign out (${user.email})`}
    >
      <LogOut size={16} />
      <Text display={{ base: "none", md: "block" }} maxW="180px" truncate>
        {user.email || "Sign out"}
      </Text>
    </Box>
  );
}
