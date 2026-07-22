import {
  Flex,
  ButtonGroup,
  IconButton,
  Icon,
  Pagination,
  Text,
  Box,
} from "@chakra-ui/react";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi2";
import { useTheme } from "../../../theme";
import { colors } from "../../../theme/colors.util";
import { SecondaryMainTitle } from "../../../shared/fonts/secondary-main-title.font";

interface ProjectsPaginationProps {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}

export function ProjectsPagination({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange,
}: ProjectsPaginationProps) {
  const { theme } = useTheme();
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <Flex justify="center" align="center" flex="1" mt={3} width="100%">
      <Pagination.Root
        count={totalItems}
        pageSize={itemsPerPage}
        page={currentPage}
        onPageChange={(details) => onPageChange(details.page)}
      >
        <ButtonGroup variant="ghost" size="sm" gap={2}>
          <Pagination.PrevTrigger asChild>
            <IconButton
              rounded="full"
              color={theme.text.primary}
              _hover={{
                bg: theme.background.hover,
                color: colors.purple.medium,
              }}
            >
              <Icon as={HiChevronLeft} />
            </IconButton>
          </Pagination.PrevTrigger>

          <Box display={{ base: "flex", md: "none" }} alignItems="center" px={2}>
            <Text fontSize="sm" color={theme.text.muted}>
              Page {currentPage} of {totalPages}
            </Text>
          </Box>

          <Box display={{ base: "none", md: "contents" }}>
            <Pagination.Items
              render={(page) => (
                <IconButton
                  rounded="full"
                  variant={page.value === currentPage ? "solid" : "ghost"}
                  bg={
                    page.value === currentPage
                      ? colors.purple.medium
                      : "transparent"
                  }
                  color={
                    page.value === currentPage ? "white" : theme.text.primary
                  }
                  _hover={{
                    bg:
                      page.value === currentPage
                        ? colors.purple.medium
                        : theme.background.hover,
                    color:
                      page.value === currentPage ? "white" : colors.purple.medium,
                  }}
                  boxShadow={
                    page.value === currentPage
                      ? `0 4px 12px ${colors.purple.medium}60`
                      : "none"
                  }
                >
                  <SecondaryMainTitle fontSize="sm">
                    {page.value}
                  </SecondaryMainTitle>
                </IconButton>
              )}
            />
          </Box>

          <Pagination.NextTrigger asChild>
            <IconButton
              rounded="full"
              color={theme.text.primary}
              _hover={{
                bg: theme.background.hover,
                color: colors.purple.medium,
              }}
            >
              <Icon as={HiChevronRight} />
            </IconButton>
          </Pagination.NextTrigger>
        </ButtonGroup>
      </Pagination.Root>
    </Flex>
  );
}
