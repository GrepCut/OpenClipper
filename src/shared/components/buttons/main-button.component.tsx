import { Button } from "@chakra-ui/react";
import type { ButtonProps } from "@chakra-ui/react";
import type { ReactNode } from "react";

interface MainButtonProps extends ButtonProps {
  children: ReactNode;
}

export const MainButton = ({ children, bgGradient, ...props }: MainButtonProps) => {
  return (
    <Button
      bg={bgGradient || props.bg}
      color="white"
      h="50px"
      px={8}
      borderRadius="2xl"
      fontSize="xl"
      fontWeight="bold"
      transition="all 0.2s"
      _active={{ transform: "translateY(0)" }}
      _hover={{
        filter: "brightness(1.1)",
        transform: "translateY(-1px)",
        _disabled: { transform: "none" },
      }}
      {...props}
    >
      {children}
    </Button>
  );
};
