import {
  Box,
  Flex,
  Heading,
  Text,
  Icon,
  Image,
} from "@chakra-ui/react";
import { motion } from "framer-motion";
import { FcGoogle } from "react-icons/fc";
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { MainButton } from "../../shared/components/buttons/main-button.component";
import { authService } from "../../services/auth.service";
import { asset } from "../../shared/utils/asset.util";

const MotionBox = motion.create(Box);

const BACK_LINES_CONFIG = [
  { height: "1px", top: "5%", width: "200px", duration: 1.2, delay: 0.1, repeatDelay: 0.6, color: "rgba(30, 144, 255, 0.3)", blur: 2 },
  { height: "1px", top: "18%", width: "180px", duration: 1.3, delay: 0.8, repeatDelay: 0.7, color: "rgba(59, 130, 246, 0.3)", blur: 2 },
  { height: "1px", top: "35%", width: "220px", duration: 1.1, delay: 1.5, repeatDelay: 0.5, color: "rgba(236, 72, 153, 0.3)", blur: 2 },
  { height: "1px", top: "62%", width: "190px", duration: 1.25, delay: 0.4, repeatDelay: 0.8, color: "rgba(6, 182, 212, 0.3)", blur: 2 },
  { height: "1px", top: "85%", width: "210px", duration: 1.15, delay: 1.1, repeatDelay: 0.6, color: "rgba(0, 195, 255, 0.3)", blur: 2 },
  { height: "2px", top: "10%", width: "280px", duration: 0.9, delay: 0.3, repeatDelay: 0.4, color: "rgba(30, 144, 255, 0.5)", blur: 1 },
  { height: "2px", top: "22%", width: "320px", duration: 0.85, delay: 1.0, repeatDelay: 0.35, color: "rgba(6, 182, 212, 0.5)", blur: 1 },
  { height: "2px", top: "40%", width: "300px", duration: 0.95, delay: 0.6, repeatDelay: 0.45, color: "rgba(236, 72, 153, 0.5)", blur: 1 },
  { height: "2px", top: "55%", width: "260px", duration: 0.88, delay: 1.4, repeatDelay: 0.4, color: "rgba(59, 130, 246, 0.5)", blur: 1 },
  { height: "2px", top: "72%", width: "290px", duration: 0.92, delay: 0.2, repeatDelay: 0.5, color: "rgba(0, 195, 255, 0.5)", blur: 1 },
  { height: "4px", top: "8%", width: "400px", duration: 0.6, delay: 0.15, repeatDelay: 0.25, color: "rgba(30, 144, 255, 0.8)", blur: 0 },
  { height: "3px", top: "28%", width: "380px", duration: 0.65, delay: 0.7, repeatDelay: 0.3, color: "rgba(236, 72, 153, 0.75)", blur: 0 },
  { height: "4px", top: "45%", width: "420px", duration: 0.55, delay: 0.4, repeatDelay: 0.2, color: "rgba(6, 182, 212, 0.8)", blur: 0 },
  { height: "3px", top: "60%", width: "360px", duration: 0.68, delay: 1.2, repeatDelay: 0.28, color: "rgba(59, 130, 246, 0.75)", blur: 0 },
];

const FRONT_LINES_CONFIG = [
  { height: "4px", top: "78%", width: "440px", duration: 0.58, delay: 0.55, repeatDelay: 0.22, color: "rgba(0, 195, 255, 0.6)", blur: 0 },
  { height: "3px", top: "92%", width: "390px", duration: 0.62, delay: 1.0, repeatDelay: 0.26, color: "rgba(34, 211, 238, 0.6)", blur: 0 },
  { height: "3px", top: "15%", width: "350px", duration: 0.5, delay: 0.9, repeatDelay: 0.8, color: "rgba(255, 255, 255, 0.4)", blur: 0, glow: true },
  { height: "3px", top: "50%", width: "380px", duration: 0.48, delay: 0.25, repeatDelay: 0.9, color: "rgba(255, 255, 255, 0.4)", blur: 0, glow: true },
  { height: "3px", top: "82%", width: "340px", duration: 0.52, delay: 1.5, repeatDelay: 0.85, color: "rgba(255, 255, 255, 0.4)", blur: 0, glow: true },
  { height: "2px", top: "35%", width: "320px", duration: 0.55, delay: 0.35, repeatDelay: 0.7, color: "rgba(30, 144, 255, 0.5)", blur: 0, glow: true },
  { height: "2px", top: "65%", width: "360px", duration: 0.52, delay: 1.1, repeatDelay: 0.65, color: "rgba(6, 182, 212, 0.5)", blur: 0, glow: true },
];

const SpeedLinesBack = () => {
  const lines = useMemo(() => BACK_LINES_CONFIG.map((config, i) => (
    <MotionBox
      key={i}
      position="absolute"
      h={config.height}
      right={250}
      top={config.top}
      width={config.width}
      bg={`linear-gradient(90deg, transparent, ${config.color}, transparent)`}
      initial={{ x: 600, opacity: 0 }}
      animate={{
        x: [600, -200],
        opacity: [0, 1, 0]
      }}
      transition={{
        duration: config.duration,
        repeat: Infinity,
        delay: config.delay,
        ease: "linear",
        repeatDelay: config.repeatDelay
      }}
      style={{
        willChange: "transform, opacity",
        filter: config.blur > 0 ? `blur(${config.blur}px)` : "none",
      }}
    />
  )), []);

  return (
    <Box
      position="absolute"
      top="-50%"
      left="-50%"
      w="200%"
      h="200%"
      zIndex={0}
      pointerEvents="none"
      overflow="hidden"
      transform="rotate(15deg)"
    >
      {lines}
    </Box>
  );
};

const SpeedLinesFront = () => {
  const lines = useMemo(() => FRONT_LINES_CONFIG.map((config, i) => (
    <MotionBox
      key={i}
      position="absolute"
      h={config.height}
      right={250}
      top={config.top}
      width={config.width}
      bg={`linear-gradient(90deg, transparent, ${config.color}, transparent)`}
      initial={{ x: 600, opacity: 0 }}
      animate={{
        x: [600, -200],
        opacity: [0, 0.9, 0]
      }}
      transition={{
        duration: config.duration,
        repeat: Infinity,
        delay: config.delay,
        ease: "linear",
        repeatDelay: config.repeatDelay
      }}
      style={{
        willChange: "transform, opacity",
        filter: config.glow ? `blur(1px) drop-shadow(0 0 8px ${config.color})` : "none",
        boxShadow: config.glow ? `0 0 15px ${config.color}, 0 0 30px ${config.color}` : "none",
        mixBlendMode: "screen",
      }}
    />
  )), []);

  return (
    <Box
      position="absolute"
      top="-50%"
      left="-50%"
      w="200%"
      h="200%"
      zIndex={2}
      pointerEvents="none"
      overflow="hidden"
      transform="rotate(15deg)"
    >
      {lines}
    </Box>
  );
};

export function AuthPage() {
  const location = useLocation();

  const intentToken = useMemo(
    () => new URLSearchParams(location.search).get("intent"),
    [location.search],
  );

  const handleGoogleLogin = () => {
    void authService.beginGoogleLogin(intentToken || undefined);
  };

  return (
    <Flex minH="100%" h="100%" bg="#050505" overflow="hidden">
      <Flex
        w="100%"
        align="center"
        justify="center"
        bg="#050505"
        position="relative"
        p={8}
      >
        <Box w="100%" maxW="480px" textAlign="center">
          <Box position="relative" mb={12} display="flex" justifyContent="center">
            <SpeedLinesBack />

            <Box rotate="15deg" position="relative" zIndex={1}>
              <Image
                src={asset("/01grepcut.webp")}
                h="220px"
                w="auto"
                objectFit="contain"
                alt="GrepCut Logo"
              />
            </Box>

            <SpeedLinesFront />
          </Box>

          <Heading
            size="2xl"
            color="white"
            mb={4}
            fontWeight="bold"
            bgGradient="linear(to-r, white, gray.400)"
            bgClip="text"
          >
            Welcome
          </Heading>
          <Text color="gray.400" fontSize="lg" mb={10}>
            Log in to continue working on your projects.
          </Text>

          <MainButton
            onClick={handleGoogleLogin}
            width="100%"
            size="lg"
            height="64px"
            fontSize="xl"
            mb={12}
            _hover={{
              transform: "translateY(-2px)",
            }}
          >
            <Icon as={FcGoogle} w={8} h={8} mr={3} />
            Continue with Google
          </MainButton>
        </Box>
      </Flex>
    </Flex>
  );
}
