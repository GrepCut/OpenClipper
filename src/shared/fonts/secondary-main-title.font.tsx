import React from "react";
import { type TextProps } from "@chakra-ui/react";
import { ThemeTitle } from "./theme-title.font";

export const SecondaryMainTitle: React.FC<TextProps> = ({
  children,
  fontSize,
  ...props
}) => (
  <ThemeTitle variant="secondary" fontSize={fontSize ?? "24px"} {...props}>
    {children}
  </ThemeTitle>
);
