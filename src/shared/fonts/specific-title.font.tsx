import React from "react";
import { type TextProps } from "@chakra-ui/react";
import { ThemeTitle } from "./theme-title.font";

export const SpecificTitle: React.FC<TextProps> = ({ children, ...props }) => (
  <ThemeTitle variant="specific" {...props}>
    {children}
  </ThemeTitle>
);
