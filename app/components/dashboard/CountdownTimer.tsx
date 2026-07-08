"use client";

import { useEffect, useState } from "react";
import { useSolanaClient } from "@solana/react-hooks";

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

export function CountdownTimer({ targetTimestamp }: CountdownTimerProps) {
  const client = useSolanaClient();
  const [isMounted, setIsMounted] = useState(false);
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    total: 999999, // default to a safe positive number to match the default layout
  });

  useEffect(() => {
    let active = true;
    async function syncClock() {
      try {
        const rpc = client.runtime.rpc;
        const slot = await rpc.getSlot().send();
        const blockTime = await rpc.getBlockTime(slot).send();
        if (blockTime !== null && active) {
          const systemNow = Math.floor(Date.now() / 1000);
          setClockOffset(Number(blockTime) - systemNow);
        }
      } catch {
        // Silently catch and fallback to local system clock
      }
    }
    syncClock();

    // Periodically resync clock offset (every 10 seconds)
    const intervalId = setInterval(syncClock, 10000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [client]);

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
      <div className="flex items-center gap-1 font-mono text-sm countdown-glow text-on-surface opacity-50 shrink-0">
        <TimeUnit value={0} label="d" />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label="h" />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label="m" />
        <span className="text-on-surface-variant/50">:</span>
        <TimeUnit value={0} label="s" />
      </div>
    );
  }

  if (timeLeft.total <= 0) {
    return (
      <span className="pill pill-warning animate-yield-pulse shrink-0 whitespace-nowrap">
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        Awaiting draw
      </span>
    );
  }

  if (timeLeft.total < 3600) {
    return (
      <span className="pill pill-error animate-yield-pulse shrink-0 whitespace-nowrap">
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
    <div className="flex items-center gap-1 font-mono text-sm countdown-glow text-on-surface shrink-0">
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
