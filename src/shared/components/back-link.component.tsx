import { HStack, Text } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useTheme } from "../../theme";

export type BackLinkOnClickProps = {
  label: string;
  onClick: () => void;
};

export type BackLinkToProps = {
  label: string;
  to: string;
};

export type BackLinkProps = BackLinkOnClickProps | BackLinkToProps;

/** onClick-only back link config (e.g. ClipperLayout header override). */
export type ClipperLayoutBackLink = BackLinkOnClickProps;

const backLinkStyles = (theme: ReturnType<typeof useTheme>["theme"]) => ({
  gap: 2,
  color: theme.text.muted,
  fontSize: "sm",
  flexShrink: 0,
  cursor: "pointer",
  _hover: { color: theme.brand.purpleLight },
});

export function BackLink(props: BackLinkProps) {
  const { theme } = useTheme();
  const styles = backLinkStyles(theme);

  if ("to" in props) {
    return (
      <HStack
        asChild
        {...styles}
        textDecoration="none"
        data-no-drag
      >
        <RouterLink to={props.to}>
          <ArrowLeft size={16} />
          <Text whiteSpace="nowrap">{props.label}</Text>
        </RouterLink>
      </HStack>
    );
  }

  return (
    <HStack
      asChild
      {...styles}
      bg="transparent"
      border="none"
      p={0}
      data-no-drag
    >
      <button type="button" onClick={props.onClick}>
        <ArrowLeft size={16} />
        <Text whiteSpace="nowrap">{props.label}</Text>
      </button>
    </HStack>
  );
}
