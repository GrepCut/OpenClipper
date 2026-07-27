import React from 'react';
import { Box } from '@chakra-ui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../../theme';

const SWITCH_ON_BG = '#007BFF';
const SWITCH_ON_BORDER = '#0056B3';
const SWITCH_ON_HOVER_BG = '#0056B3';
const SWITCH_ON_GLOW = 'rgba(0, 123, 255, 0.25)';

interface ModernSwitchProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    label?: string;
    disabled?: boolean;
}

export const ModernSwitch: React.FC<ModernSwitchProps> = ({
    checked,
    onCheckedChange,
    disabled = false
}) => {
    const { theme } = useTheme();

    return (
        <Box
            as="button"
            role="switch"
            aria-checked={checked}
            {...({ disabled } as any)}
            onClick={() => !disabled && onCheckedChange(!checked)}
            position="relative"
            width="42px"
            height="22px"
            display="flex"
            alignItems="center"
            padding="2px"
            borderRadius="full"
            cursor={disabled ? "not-allowed" : "pointer"}
            bg={checked ? SWITCH_ON_BG : "#2D3748"}
            border="1px solid"
            borderColor={checked ? SWITCH_ON_BORDER : "rgba(255, 255, 255, 0.1)"}
            transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
            opacity={disabled ? 0.5 : 1}
            _hover={!disabled ? {
                bg: checked ? SWITCH_ON_HOVER_BG : "#4A5568",
                boxShadow: checked ? `0 0 10px ${SWITCH_ON_GLOW}` : undefined,
            } : {}}
            _focusVisible={{
                outline: "none",
                boxShadow: `0 0 0 2px ${theme.border.focus}`
            }}
        >
            <motion.div
                initial={false}
                animate={{
                    x: checked ? 20 : 0,
                    scale: checked ? 1 : 0.9,
                }}
                transition={{
                    type: "spring",
                    stiffness: 500,
                    damping: 30
                }}
                style={{
                    width: '16px',
                    height: '16px',
                    backgroundColor: 'white',
                    borderRadius: '50%',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2
                }}
            />

            <AnimatePresence>
                {checked && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            borderRadius: '9999px',
                            boxShadow: 'inset 0 0 8px rgba(255, 255, 255, 0.2)',
                            pointerEvents: 'none'
                        }}
                    />
                )}
            </AnimatePresence>
        </Box>
    );
};
