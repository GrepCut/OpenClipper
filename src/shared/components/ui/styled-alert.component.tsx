import { Alert } from "@chakra-ui/react";
import { SpecificTitle } from "../../fonts/specific-title.font";
import type { ReactNode } from "react";

interface StyledAlertProps {
  status: "warning" | "error" | "info" | "success";
  title: string;
  description: ReactNode;
}

const alertStyles = {
  warning: {
    bg: "orange.500/20",
    borderColor: "orange.500/40",
    indicatorColor: "orange.500",
  },
  error: {
    bg: "red.500/20",
    borderColor: "red.500/40",
    indicatorColor: "red.500",
  },
  info: {
    bg: "blue.500/20",
    borderColor: "blue.500/40",
    indicatorColor: "blue.500",
  },
  success: {
    bg: "green.500/20",
    borderColor: "green.500/40",
    indicatorColor: "green.500",
  },
};

export const StyledAlert = ({
  status,
  title,
  description,
}: StyledAlertProps) => {
  const styles = alertStyles[status];

  return (
    <Alert.Root
      status={status}
      bg={styles.bg}
      borderRadius="2xl"
      borderWidth="1px"
      borderColor={styles.borderColor}
    >
      <Alert.Indicator color={styles.indicatorColor} />
      <Alert.Content>
        <SpecificTitle as={Alert.Title} fontSize="md">
          {title}
        </SpecificTitle>
        <SpecificTitle as={Alert.Description} fontSize="sm">
          {description}
        </SpecificTitle>
      </Alert.Content>
    </Alert.Root>
  );
};
