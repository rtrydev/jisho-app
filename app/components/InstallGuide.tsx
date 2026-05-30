"use client";

import { useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";
import { Segmented } from "./Segmented";
import { Eyebrow, RuleGold } from "./Eyebrow";
import { Note } from "./Note";
import { Button } from "./Button";
import * as Icon from "./Icon";
import type { InstallPlatform } from "../lib/installPrompt";

type DeviceTab = "ios" | "android";

/** Small inline glyph echoing a real on-screen control, so a step can say
 *  "tap the [share] button" and the user knows exactly what to look for. */
function InlineIcon({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="ig-inline" role="img" aria-label={label}>
      {children}
    </span>
  );
}

const STEPS: Record<DeviceTab, ReactNode[]> = {
  ios: [
    <>
      Tap the Share button{" "}
      <InlineIcon label="Share">
        <Icon.ShareArrow size={14} />
      </InlineIcon>{" "}
      in Safari&rsquo;s toolbar.
    </>,
    <>
      Scroll the list and choose <strong>Add to Home Screen</strong>{" "}
      <InlineIcon label="Add to Home Screen">
        <Icon.PlusSquare size={14} />
      </InlineIcon>
      .
    </>,
    <>
      Tap <strong>Add</strong> in the top-right corner.
    </>,
    <>
      Open Jisho from your Home Screen — it runs full-screen, offline, and
      keeps your library on this device.
    </>,
  ],
  android: [
    <>
      Open the browser menu{" "}
      <InlineIcon label="Menu">
        <Icon.Overflow size={14} />
      </InlineIcon>{" "}
      in Chrome&rsquo;s toolbar.
    </>,
    <>
      Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>).
    </>,
    <>
      Confirm with <strong>Install</strong>.
    </>,
    <>
      Open Jisho from your Home Screen — it runs full-screen, offline, and
      keeps your library on this device.
    </>,
  ],
};

const DEVICE_OPTIONS = [
  { value: "ios" as const, label: "iPhone" },
  { value: "android" as const, label: "Android" },
];

const TAB_NOTE: Record<DeviceTab, string> = {
  ios: "These steps are for Safari — other iOS browsers can’t add to the Home Screen.",
  android: "Wording varies slightly across Chrome, Edge, and Samsung Internet.",
};

/** Inner sheet — split out so it mounts fresh each time the guide opens,
 *  which re-seeds the device tab from the detected platform. */
function InstallGuideSheet({
  platform,
  onClose,
}: {
  platform: InstallPlatform;
  onClose: () => void;
}) {
  // Seed the tab from the device, defaulting unknown platforms to iOS.
  const [tab, setTab] = useState<DeviceTab>(
    platform === "android" ? "android" : "ios",
  );

  return (
    <>
      {/* Scrim dims the whole app (the guide mounts at `.app` level, so this
          covers the top bar too) and dismisses on an outside tap; Escape and
          the sheet's own close button are the other two exits. */}
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <Sheet size="fit" ariaLabel="Install Jisho" onClose={onClose}>
        <div className="ig">
          <Eyebrow>Add to Home Screen</Eyebrow>
          <h2 className="ig-title serif">Install Jisho</h2>
          <p className="ig-lede ink-soft">
            Keep the dictionary one tap away — install it to your Home Screen
            for a full-screen, offline-ready reading space.
          </p>

          <RuleGold className="ig-rule" />

          <Segmented<DeviceTab>
            value={tab}
            options={DEVICE_OPTIONS}
            onChange={setTab}
            ariaLabel="Choose your device"
          />

          <ol className="ig-steps">
            {STEPS[tab].map((step, i) => (
              <li key={i} className="ig-step">
                <span className="ig-step-n" aria-hidden>
                  {i + 1}
                </span>
                <span className="ig-step-text">{step}</span>
              </li>
            ))}
          </ol>

          <Note className="ig-note">{TAB_NOTE[tab]}</Note>

          <div className="ig-foot">
            <Button variant="primary" onClick={onClose}>
              Got it
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}

/** Add-to-Home-Screen walkthrough. Purely presentational: the parent owns the
 *  open/close state and the detected platform (see useInstallPrompt). Renders
 *  nothing when closed. */
export function InstallGuide({
  open,
  platform,
  onClose,
}: {
  open: boolean;
  platform: InstallPlatform;
  onClose: () => void;
}) {
  if (!open) return null;
  return <InstallGuideSheet platform={platform} onClose={onClose} />;
}
