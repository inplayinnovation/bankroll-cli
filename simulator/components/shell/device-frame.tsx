"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { getMetrics, type ButtonSpec } from "@/lib/devices";
import { useShell } from "./device-provider";
import { SystemUI } from "./system-ui";

/**
 * The phone, layered the way the Simulator composites it: side buttons, then
 * the bezel art, then the screen clipped to its exact outline, then the
 * Dynamic Island or notch.
 *
 * The hardware layers are laid out upright and rotated as a whole for
 * landscape. The screen is never rotated; it just swaps width and height.
 */
export function DeviceFrame({ children }: { children: ReactNode }) {
  const { device, orientation, geometry, safeArea } = useShell();
  const { bezel, portraitWindow, screen, outline, hardwareTransform } = geometry;
  const { island } = getMetrics(device);

  const hardware: CSSProperties = { width: portraitWindow.width, height: portraitWindow.height, transform: hardwareTransform };
  // Upright position of the screen, for placing the island and notch.
  const screenLeft = bezel.padding.left + bezel.inset;
  const screenTop = bezel.padding.top + bezel.inset;

  return (
    <div className="device">
      <div
        className="device-shadow"
        style={{
          left: screen.x - bezel.inset + 2,
          top: screen.y - bezel.inset + 2,
          width: screen.width + 2 * bezel.inset - 4,
          height: screen.height + 2 * bezel.inset - 4,
          borderRadius: bezel.cornerRadius - 2,
        }}
      />

      <div className="hardware" style={hardware} aria-hidden>
        {bezel.buttons.map((button) => (
          <SideButton key={button.name} button={button} />
        ))}
        <div
          className="hardware-art"
          style={{
            left: bezel.padding.left,
            top: bezel.padding.top,
            width: bezel.width,
            height: bezel.height,
            backgroundImage: `url(${bezel.src})`,
          }}
        />
      </div>

      <div
        className="screen"
        data-device-screen
        data-orientation={orientation}
        style={
          {
            left: screen.x,
            top: screen.y,
            width: screen.width,
            height: screen.height,
            clipPath: `path("${outline}")`,
            "--safe-top": `${safeArea.top}px`,
            "--safe-right": `${safeArea.right}px`,
            "--safe-bottom": `${safeArea.bottom}px`,
            "--safe-left": `${safeArea.left}px`,
          } as CSSProperties
        }
      >
        {children}
        <SystemUI />
      </div>

      <div className="hardware" style={hardware} aria-hidden>
        {island ? (
          <div
            className="island"
            style={{
              left: screenLeft + (device.screen.width - island.width) / 2,
              top: screenTop + island.top,
              width: island.width,
              height: island.height,
            }}
          />
        ) : (
          device.notch && (
            <div
              className="hardware-art"
              style={{
                left: screenLeft + (device.screen.width - device.notch.width) / 2,
                top: screenTop,
                width: device.notch.width,
                height: device.notch.height,
                backgroundImage: `url(${device.notch.src})`,
              }}
            />
          )
        )}
      </div>
    </div>
  );
}

/**
 * Like the Simulator's: mostly tucked under the bezel, slides out on hover and
 * shows its pressed art while held. It does nothing else.
 */
function SideButton({ button }: { button: ButtonSpec }) {
  const [on, setOn] = useState(false);
  const slide = button.hoverX - button.x;
  // The hit area covers both positions, so the button does not slide out from under the pointer.
  const left = Math.min(button.x, button.hoverX);

  return (
    <div
      className="side-button"
      data-on={on || undefined}
      style={{ left, top: button.y, width: button.width + Math.abs(slide), height: button.height, "--slide": `${slide}px` } as CSSProperties}
      onClick={button.kind === "switch" ? () => setOn((value) => !value) : undefined}
    >
      <div className="side-button-art" style={{ left: button.x - left, width: button.width, backgroundImage: `url(${button.src})` }}>
        <div className="side-button-down" style={{ backgroundImage: `url(${button.srcDown})` }} />
      </div>
    </div>
  );
}
