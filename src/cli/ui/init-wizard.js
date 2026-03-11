import React, { useState } from "react";
import { Box, Text, render, useInput } from "ink";

const CHANNEL_OPTIONS = [
  { label: "npm", value: "npm" },
  { label: "Codex", value: "codex" },
  { label: "Claude", value: "claude" },
  { label: "Other / Unknown", value: "unknown" }
];
const ANALYTICS_OPTIONS = [
  { label: "Enable anonymous metrics (recommended)", value: true },
  { label: "No thanks", value: false }
];

function findChannelIndex(channel) {
  const normalized = String(channel || "").trim().toLowerCase();
  const index = CHANNEL_OPTIONS.findIndex((option) => option.value === normalized);
  return index === -1 ? CHANNEL_OPTIONS.length - 1 : index;
}

function SelectList({ title, options, selectedIndex }) {
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { bold: true }, title),
    ...options.map((option, index) =>
      React.createElement(
        Text,
        { key: option.value },
        `${index === selectedIndex ? "❯" : " "} ${option.label}`
      )
    ),
    React.createElement(Text, { dimColor: true }, "Use ↑/↓ then Enter.")
  );
}

function BooleanSelectList({ title, options, selectedIndex }) {
  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { bold: true }, title),
    ...options.map((option, index) =>
      React.createElement(
        Text,
        { key: option.label },
        `${index === selectedIndex ? "❯" : " "} ${option.label}`
      )
    ),
    React.createElement(Text, { dimColor: true }, "Use ↑/↓ then Enter.")
  );
}

function InitWizard({ defaults, onComplete, onCancel }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [channelIndex, setChannelIndex] = useState(findChannelIndex(defaults.channel));
  const [analyticsIndex, setAnalyticsIndex] = useState(defaults.analyticsEnabled ? 0 : 1);
  const steps = ["welcome", "select-channel", "select-analytics", "confirm"];
  const step = steps[stepIndex];

  function nextStep() {
    setStepIndex((current) => current + 1);
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onCancel(new Error("Setup canceled."));
      return;
    }

    if (step === "welcome") {
      if (key.return) {
        nextStep();
      }
      return;
    }

    if (step === "select-channel") {
      if (key.upArrow) {
        setChannelIndex((current) =>
          current > 0 ? current - 1 : CHANNEL_OPTIONS.length - 1
        );
        return;
      }
      if (key.downArrow) {
        setChannelIndex((current) =>
          current < CHANNEL_OPTIONS.length - 1 ? current + 1 : 0
        );
        return;
      }
      if (key.return) {
        nextStep();
      }
      return;
    }

    if (step === "select-analytics") {
      if (key.upArrow || key.downArrow) {
        setAnalyticsIndex((current) => (current === 0 ? 1 : 0));
        return;
      }
      if (key.return) {
        nextStep();
      }
      return;
    }

    if (step === "confirm" && key.return) {
      onComplete({
        channel: CHANNEL_OPTIONS[channelIndex].value,
        analyticsEnabled: ANALYTICS_OPTIONS[analyticsIndex].value
      });
    }
  });

  const contentByStep = {
    welcome: React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Welcome to Job Finder. Let's get you set up."),
      React.createElement(Text, { dimColor: true }, "Press Enter to continue.")
    ),
    "select-channel": React.createElement(SelectList, {
      title: "How did you install Job Finder?",
      options: CHANNEL_OPTIONS,
      selectedIndex: channelIndex
    }),
    "select-analytics": React.createElement(BooleanSelectList, {
      title: "Please enable anonymous metrics so we can improve Job Finder.",
      options: ANALYTICS_OPTIONS,
      selectedIndex: analyticsIndex
    }),
    confirm: React.createElement(
      Box,
      { flexDirection: "column" },
      React.createElement(Text, { bold: true }, "Ready to initialize"),
      React.createElement(Text, { dimColor: true }, "Press Enter to continue, or Ctrl+C to cancel.")
    )
  };

  return React.createElement(
    Box,
    { flexDirection: "column" },
    React.createElement(Text, { dimColor: true }, `Step ${stepIndex + 1}/${steps.length}`),
    contentByStep[step]
  );
}

export async function runInkInitWizard(options = {}) {
  const defaults = {
    channel: options.defaultChannel || "unknown",
    analyticsEnabled: Boolean(options.defaultAnalyticsEnabled)
  };

  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = async (app, next) => {
      if (settled) {
        return;
      }
      settled = true;
      app.unmount();
      try {
        await app.waitUntilExit();
      } catch {
        // ignore teardown errors during shutdown
      }
      next();
    };

    const app = render(
      React.createElement(InitWizard, {
        defaults,
        onComplete: (result) => {
          void settle(app, () => resolve(result));
        },
        onCancel: (error) => {
          void settle(app, () => reject(error));
        }
      })
    );

    app.waitUntilExit().catch((error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });
}
