import React, { useEffect, useState } from "react";
import { isTauri } from "../utils/platform.util";
import {
  closeWindow,
  isMaximized,
  minimizeWindow,
  toggleMaximize,
} from "../utils/tauri-window.util";

/* ──────────── Icon components ──────────── */

const MinimizeIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="0" y="4.5" width="10" height="1" rx="0.5" fill="currentColor" />
  </svg>
);

const MaximizeIcon: React.FC<{ isMaximized: boolean }> = ({ isMaximized: isMax }) =>
  isMax ? (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 3h5v5H2V3z" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M3 3V2h5v5H7" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1" y="1" width="8" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  );

const CloseIcon: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

/* ──────────── WindowControls component ──────────── */

interface WindowControlsProps {
  textColor?: string;
  btnHoverBg?: string;
  closeBtnHoverBg?: string;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
  textColor = "currentColor",
  btnHoverBg = "rgba(255, 255, 255, 0.08)",
  closeBtnHoverBg = "#e81123",
}) => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    isMaximized().then(setMaximized).catch(() => {});

    let cleanup: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const unlisten = await win.onResized(async () => {
          try {
            const max = await win.isMaximized();
            setMaximized(max);
          } catch (error) {
            console.error("[WindowControls] onResized failed", error);
          }
        });
        cleanup = unlisten;
      } catch (error) {
        console.error("[WindowControls] failed to subscribe to onResized", error);
      }
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  if (!isTauri()) return null;

  return (
    <div
      data-no-drag
      style={{
        display: "flex",
        alignItems: "stretch",
        alignSelf: "stretch",
        height: "100%",
        flexShrink: 0,
        minWidth: "138px",
      }}
    >
      <ControlButton
        onClick={minimizeWindow}
        hoverBg={btnHoverBg}
        title="Minimize"
        textColor={textColor}
      >
        <MinimizeIcon />
      </ControlButton>

      <ControlButton
        onClick={async () => {
          await toggleMaximize();
          const max = await isMaximized();
          setMaximized(max);
        }}
        hoverBg={btnHoverBg}
        title={maximized ? "Restore" : "Maximize"}
        textColor={textColor}
      >
        <MaximizeIcon isMaximized={maximized} />
      </ControlButton>

      <ControlButton
        onClick={closeWindow}
        hoverBg={closeBtnHoverBg}
        hoverColor="#ffffff"
        title="Close"
        textColor={textColor}
      >
        <CloseIcon />
      </ControlButton>
    </div>
  );
};

/* ──────────── ControlButton helper ──────────── */

interface ControlButtonProps {
  onClick: () => void;
  hoverBg: string;
  hoverColor?: string;
  title: string;
  textColor: string;
  children: React.ReactNode;
}

const ControlButton: React.FC<ControlButtonProps> = ({
  onClick,
  hoverBg,
  hoverColor,
  title,
  textColor,
  children,
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      data-titlebar-btn
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        width: "46px",
        height: "100%",
        minHeight: "100%",
        border: "none",
        outline: "none",
        cursor: "pointer",
        background: hovered ? hoverBg : "transparent",
        color: hovered && hoverColor ? hoverColor : textColor,
        transition: "background 0.15s ease, color 0.15s ease",
        padding: 0,
        margin: 0,
        lineHeight: 0,
      }}
    >
      {children}
    </button>
  );
};
