import React from "react";
import type { ActivityType } from "@/app/types";

export function dotColor(type: ActivityType): string {
  switch (type) {
    case "deposit":
      return "border-primary";
    case "win":
      return "border-secondary";
    case "auto-reinvest":
      return "border-tertiary";
    case "withdraw":
      return "border-error";
    case "claim-redemption":
      return "border-primary-dim";
    default:
      return "border-outline";
  }
}

export function typeIcon(type: ActivityType): React.ReactNode {
  switch (type) {
    case "deposit":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      );
    case "win":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-secondary"
        >
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    case "auto-reinvest":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-tertiary"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <polyline points="21 3 21 8 16 8" />
        </svg>
      );
    case "withdraw":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-error"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case "claim-redemption":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary-dim"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    default:
      return null;
  }
}
