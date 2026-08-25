import { Box, Image, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import type { User } from "../types/auth.types";
import { getUserInitials } from "../utils/user-display.util";
import { useTheme } from "../../theme";

interface UserAvatarProps {
  user: User;
  size?: number;
}

export function UserAvatar({ user, size = 28 }: UserAvatarProps) {
  const { theme } = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const initials = getUserInitials(user);
  const showImage = Boolean(user.picture) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [user.picture]);

  return (
    <Box
      position="relative"
      w={`${size}px`}
      h={`${size}px`}
      flexShrink={0}
      borderRadius="full"
      overflow="hidden"
      border="1px solid"
      borderColor={theme.dashboard.border}
      bg={theme.surface.active}
      display="flex"
      alignItems="center"
      justifyContent="center"
      aria-hidden
    >
      <Text
        fontSize={`${Math.max(10, Math.round(size * 0.38))}px`}
        fontWeight="700"
        color={theme.text.primary}
        lineHeight="1"
        letterSpacing="-0.02em"
        userSelect="none"
      >
        {initials}
      </Text>
      {showImage ? (
        <Image
          src={user.picture ?? undefined}
          alt=""
          position="absolute"
          inset={0}
          w="full"
          h="full"
          objectFit="cover"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      ) : null}
    </Box>
  );
}
