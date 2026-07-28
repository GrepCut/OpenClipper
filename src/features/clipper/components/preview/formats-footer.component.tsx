import React from "react";
import { VStack } from "@chakra-ui/react";
import { ClipperFormatCard } from "../clipper-format-card.component";
import { ClipperHorizontalCarousel } from "../clipper-horizontal-carousel.component";
import type { ClipperPreviewFormatsFooterProps } from "./clipper-preview.types";

export function ClipperPreviewFormatsFooter({
  secondaryFormats,
  registerCanvas,
}: ClipperPreviewFormatsFooterProps) {
  return (
    <VStack align="stretch" gap={6} pt={4}>
      {secondaryFormats.length > 0 ? (
        <ClipperHorizontalCarousel>
          {secondaryFormats.map((formatDef) => (
            <ClipperFormatCard
              key={formatDef.id}
              formatId={formatDef.id}
              platform={formatDef.platform}
              label={formatDef.label}
            >
              <canvas
                ref={(el) => {
                  registerCanvas(formatDef.id, el);
                }}
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                }}
              />
            </ClipperFormatCard>
          ))}
        </ClipperHorizontalCarousel>
      ) : null}
    </VStack>
  );
}
