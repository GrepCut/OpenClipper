import { useState } from "react";
import { Box, Text, VStack } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useTheme } from "../../theme";
import { useAuth } from "../../shared/hooks/use-auth.hook";
import { OutlinedActionButton } from "../../shared/components/buttons/outlined-action-button.component";
import { SecondaryMainTitle } from "../../shared/fonts/secondary-main-title.font";
import { DeleteAccountModal } from "./delete-account-modal.component";

const HAZARD_STRIPE_BG =
  "repeating-linear-gradient(-45deg, #101010 0, #101010 6px, #c9a227 6px, #c9a227 12px)";

export function DeleteAccountSection() {
  const { theme, mode } = useTheme();
  const { user, token, isAuthenticated, sessionMode } = useAuth();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const online = Boolean(
    user && token && isAuthenticated && sessionMode === "online",
  );
  if (!online) {
    return null;
  }

  const cardBg = mode === "dark" ? "whiteAlpha.50" : "white";
  const dangerBorder =
    mode === "dark" ? "rgba(248, 113, 113, 0.16)" : "rgba(220, 38, 38, 0.14)";

  return (
    <>
      <Box
        mb={10}
        borderRadius="2xl"
        border="1px solid"
        borderColor={dangerBorder}
        bg={cardBg}
        boxShadow={
          mode === "dark"
            ? "0 4px 24px rgba(0,0,0,0.2)"
            : "0 4px 24px rgba(0,0,0,0.04)"
        }
        overflow="hidden"
      >
        <Box position="relative" px={5} pt={5} pb={6}>
          <Box
            position="absolute"
            right={0}
            bottom={0}
            w={{ base: "38%", md: "28%" }}
            maxW="168px"
            h={{ base: "72%", md: "68%" }}
            pointerEvents="none"
            aria-hidden
            bgImage={HAZARD_STRIPE_BG}
            opacity={mode === "dark" ? 0.07 : 0.05}
            css={{
              maskImage:
                "radial-gradient(ellipse 100% 100% at 100% 100%, black 0%, transparent 78%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 100% 100% at 100% 100%, black 0%, transparent 78%)",
            }}
          />

          <VStack
            align="stretch"
            gap={5}
            maxW={{ base: "full", md: "min(100%, 34rem)" }}
            position="relative"
            zIndex={1}
          >
            <VStack align="start" gap={1.5}>
              <SecondaryMainTitle color={theme.status.danger}>
                Danger zone
              </SecondaryMainTitle>
              <Text fontSize="sm" color={theme.text.muted} lineHeight="1.65">
                Permanently delete your account and all associated data. Active
                Paddle subscriptions are canceled immediately during deletion.
              </Text>
            </VStack>

            <Box alignSelf={{ base: "stretch", sm: "flex-start" }}>
              <OutlinedActionButton
                tone="danger"
                startIcon={<Trash2 size={16} />}
                onClick={() => setIsModalOpen(true)}
              >
                Delete account
              </OutlinedActionButton>
            </Box>
          </VStack>
        </Box>

        <Box
          h="7px"
          aria-hidden
          bgImage={HAZARD_STRIPE_BG}
          opacity={mode === "dark" ? 0.85 : 0.92}
        />
      </Box>

      <DeleteAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
