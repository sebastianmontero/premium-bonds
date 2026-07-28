"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useOnChainClock } from "@/app/hooks/useOnChainClock";

interface CountdownTimerProps {
  targetTimestamp: number; // unix seconds
  resyncIntervalMs?: number;
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calcTimeLeft(target: number, offset: number): TimeLeft {
  const now = Math.floor(Date.now() / 1000) + offset;
  const total = Math.max(0, target - now);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}

export function CountdownTimer({
  targetTimestamp,
  resyncIntervalMs,
}: CountdownTimerProps) {
  const t = useTranslations("Countdown");
  const format = useFormatter();
  const [isMounted, setIsMounted] = useState(false);
  const { clockOffset } = useOnChainClock({ resyncIntervalMs });
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    total: 999999, // default to a safe positive number to match the default layout
  });

  const formattedTargetDate =
    targetTimestamp > 0
      ? format.dateTime(new Date(targetTimestamp * 1000), {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : undefined;

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (active) {
        setIsMounted(true);
        setTimeLeft(calcTimeLeft(targetTimestamp, clockOffset));
      }
    });

    const id = setInterval(() => {
      if (active) {
        setTimeLeft(calcTimeLeft(targetTimestamp, clockOffset));
      }
    }, 1000);

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      clearInterval(id);
    };
  }, [targetTimestamp, clockOffset]);

  if (!isMounted) {
    return (
      <div
        className="flex items-center gap-1 font-mono text-sm countdown-glow text-on-surface opacity-50 shrink-0"
        title={formattedTargetDate}
      >
        <TimeUnit value={0} label={t("days")} />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label={t("hours")} />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label={t("minutes")} />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label={t("seconds")} />
      </div>
    );
  }

  if (timeLeft.total <= 0) {
    return (
      <span
        className="pill pill-warning animate-yield-pulse shrink-0 whitespace-nowrap"
        title={formattedTargetDate}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t("awaitingDraw")}
      </span>
    );
  }

  if (timeLeft.total < 3600) {
    return (
      <span
        className="pill pill-error animate-yield-pulse shrink-0 whitespace-nowrap"
        title={formattedTargetDate}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {t("drawImminent")}&nbsp;
        <span className="font-mono">
          {String(timeLeft.minutes).padStart(2, "0")}
          {t("minutes")} {String(timeLeft.seconds).padStart(2, "0")}
          {t("seconds")}
        </span>
      </span>
    );
  }

  return (
    <div
      className="flex items-center gap-1 font-mono text-sm countdown-glow text-on-surface shrink-0"
      title={formattedTargetDate}
    >
      <TimeUnit value={timeLeft.days} label={t("days")} />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.hours} label={t("hours")} />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.minutes} label={t("minutes")} />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.seconds} label={t("seconds")} />
    </div>
  );
}

function TimeUnit({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-0.5">
      <span className="text-on-surface font-semibold tabular-nums">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[10px] text-on-surface-variant">{label}</span>
    </span>
  );
}
