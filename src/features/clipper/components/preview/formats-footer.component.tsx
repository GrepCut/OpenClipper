import React from "react";
import { Button, HStack, VStack } from "@chakra-ui/react";
import { ClipperFormatCard } from "../clipper-format-card.component";
import { ClipperHorizontalCarousel } from "../clipper-horizontal-carousel.component";
import type { ClipperPreviewFormatsFooterProps } from "./clipper-preview.types";

export function ClipperPreviewFormatsFooter({
  secondaryFormats,
  canvasRefs,
  exportCount,
  isRendering,
  onViewExports,
  outlineButton,
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
                  canvasRefs.current[formatDef.id] = el;
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

      {(exportCount > 0 || isRendering) && onViewExports ? (
        <HStack justify="flex-start" gap={4} flexWrap="wrap" pt={2}>
          <Button
            size="lg"
            variant="outline"
            borderRadius="2xl"
            onClick={onViewExports}
            {...outlineButton}
          >
            Your exports{exportCount > 0 ? ` (${exportCount})` : ""}
          </Button>
        </HStack>
      ) : null}
    </VStack>
  );
}
