"use client";

import { useEffect, useState } from "react";

interface CountdownTimerProps {
  targetTimestamp: number; // unix seconds
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

function calcTimeLeft(target: number): TimeLeft {
  const now = Math.floor(Date.now() / 1000);
  const total = Math.max(0, target - now);
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}

export function CountdownTimer({ targetTimestamp }: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(calcTimeLeft(targetTimestamp));

  useEffect(() => {
    const id = setInterval(() => {
      setTimeLeft(calcTimeLeft(targetTimestamp));
    }, 1000);
    return () => clearInterval(id);
  }, [targetTimestamp]);

  if (timeLeft.total <= 0) {
    return (
      <span className="pill pill-warning animate-yield-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Awaiting draw…
      </span>
    );
  }

  if (timeLeft.total < 3600) {
    return (
      <span className="pill pill-error animate-yield-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Draw imminent!&nbsp;
        <span className="font-mono">
          {String(timeLeft.minutes).padStart(2, "0")}m{" "}
          {String(timeLeft.seconds).padStart(2, "0")}s
        </span>
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1 font-mono text-sm countdown-glow text-on-surface">
      <TimeUnit value={timeLeft.days} label="d" />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.hours} label="h" />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.minutes} label="m" />
      <span className="text-on-surface-variant/50">:</span>
      <TimeUnit value={timeLeft.seconds} label="s" />
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
