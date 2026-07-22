import React from "react";
import { Box, HStack, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { useTheme } from "../../../theme";

const bounce = keyframes`
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1.1); opacity: 1; }
`;

interface ThinkingDotsProps {
  textColor?: string;
  label?: string;
}

export const ThinkingDots: React.FC<ThinkingDotsProps> = ({
  textColor,
  label = "THINKING",
}) => {
  const { theme } = useTheme();
  const color = textColor || theme.text.muted;

  return (
    <HStack gap={2} minH="20px" alignItems="center" px={1}>
      <Text
        fontSize="10px"
        fontWeight="800"
        color={color}
        letterSpacing="0.1em"
        opacity={0.7}
      >
        {label}
      </Text>
      <HStack gap={1}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            w="4px"
            h="4px"
            borderRadius="full"
            bg={color}
            animation={`${bounce} 1.4s ease-in-out ${i * 0.16}s infinite`}
          />
        ))}
      </HStack>
    </HStack>
  );
};
