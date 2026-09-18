import { useEffect, useState } from "react";
import { Box, HStack, Spinner, Text, chakra } from "@chakra-ui/react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../shared/hooks/use-auth.hook";
import { rememberAuthReturnPath } from "../../../shared/auth/auth-return-path.util";
import { UserAvatar } from "../../../shared/components/user-avatar.component";
import { getUserDisplayName } from "../../../shared/utils/user-display.util";
import { useTheme } from "../../../theme";
import { clipperTheme } from "../../clipper/shared/theme.util";
import { LogoutConfirmModal } from "./logout-confirm-modal.component";

export function AccountHeaderAction() {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, hasTriedInit, isLoggingOut } = useAuth();
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setIsLogoutModalOpen(false);
    }
  }, [isAuthenticated]);

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
    <>
      <HStack
        gap={1.5}
        align="center"
        flexShrink={0}
        pl={1}
        pr={0.5}
        py={0.5}
        mr={1}
        borderRadius="full"
        bg={theme.surface.subtle}
        border="1px solid"
        borderColor={theme.border.primary}
        data-no-drag=""
      >
        <UserAvatar user={user} size={24} />
        <Text
          fontSize="xs"
          fontWeight="700"
          letterSpacing="-0.01em"
          color={theme.text.primary}
          maxW="160px"
          truncate
          title={user.email}
        >
          {displayName}
        </Text>
        <chakra.button
          type="button"
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          w="28px"
          h="28px"
          borderRadius="full"
          color={theme.status.danger}
          bg="transparent"
          cursor={isLoggingOut ? "wait" : "pointer"}
          disabled={isLoggingOut}
          aria-busy={isLoggingOut}
          aria-label="Log out"
          title={`Sign out (${user.email})`}
          onClick={() => {
            if (isLoggingOut) return;
            setIsLogoutModalOpen(true);
          }}
          transition="all 0.2s ease"
          _hover={
            isLoggingOut
              ? undefined
              : {
                  bg: theme.interactive.destructiveHover,
                }
          }
        >
          {isLoggingOut ? (
            <Spinner size="xs" borderWidth="2px" />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M12 2v10" />
              <path d="M18.36 6.64a9 9 0 1 1-12.72 0" />
            </svg>
          )}
        </chakra.button>
      </HStack>
      <LogoutConfirmModal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
      />
    </>
  );
}
