"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { copyToClipboard } from "@/app/lib/clipboard";

export interface UseClipboardOptions {
  timeoutMs?: number;
  onSuccess?: (text: string) => void;
  onError?: (error: unknown) => void;
}

export function useClipboard({
  timeoutMs = 2000,
  onSuccess,
  onError,
}: UseClipboardOptions = {}) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      if (!text) return false;
      try {
        const success = await copyToClipboard(text);
        if (success) {
          setCopied(true);
          onSuccessRef.current?.(text);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), timeoutMs);
          return true;
        } else {
          throw new Error("Clipboard copy failed");
        }
      } catch (err) {
        onErrorRef.current?.(err);
        return false;
      }
    },
    [timeoutMs]
  );

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCopied(false);
  }, []);

  return { copied, copy, reset };
}
