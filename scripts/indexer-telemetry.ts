export interface ChunkProgress {
  readonly chunkNumber: number; // 1-based (e.g. 1)
  readonly totalChunks: number; // Total chunks in page (e.g. 34)
  readonly txStartIndex: number; // 1-based start (e.g. 1)
  readonly txEndIndex: number; // 1-based end clamped (e.g. 3)
  readonly totalTransactions: number; // Total valid txs in page (e.g. 100)
}

export type IndexerProgressEvent =
  | {
      readonly phase: "querying_signatures";
      readonly page: number;
      readonly beforeSig?: string;
      readonly untilSig?: string;
    }
  | {
      readonly phase: "signatures_discovered";
      readonly page: number;
      readonly totalDiscovered: number;
      readonly validCount: number;
    }
  | {
      readonly phase: "fetching_transactions";
      readonly page: number;
      readonly chunk: ChunkProgress;
      readonly eventsParsedSoFar: number;
    }
  | {
      readonly phase: "ingesting_batch";
      readonly page: number;
      readonly batchSize: number;
      readonly insertedCount?: number;
      readonly durationMs?: number;
    }
  | {
      readonly phase: "hydrating_draws";
      readonly page: number;
    }
  | {
      readonly phase: "reconciling_settlements";
      readonly poolStateAddress: string;
    }
  | {
      readonly phase: "complete";
      readonly totalIngested: number;
      readonly totalScanned: number;
      readonly totalPages: number;
    }
  | {
      readonly phase: "aborted";
      readonly page: number;
      readonly reason: string;
      readonly error?: unknown;
    };

export function formatIndexerProgressMessage(
  event: IndexerProgressEvent
): string {
  switch (event.phase) {
    case "querying_signatures": {
      const untilStr = event.untilSig
        ? `until: ${event.untilSig}`
        : "until: GENESIS / INCEPTION";
      const beforeStr = event.beforeSig ? `, before: ${event.beforeSig}` : "";
      return `[Indexer Sync] [Page ${event.page}] Querying signatures (${untilStr}${beforeStr})...`;
    }
    case "signatures_discovered": {
      return `[Indexer Sync] [Page ${event.page}] Discovered ${event.totalDiscovered} signatures (${event.validCount} valid).`;
    }
    case "fetching_transactions": {
      const pct =
        event.chunk.totalTransactions > 0
          ? Math.round(
              (event.chunk.txEndIndex / event.chunk.totalTransactions) * 100
            )
          : 100;
      return `[Indexer Sync] [Page ${event.page}] Fetching chunk ${event.chunk.chunkNumber}/${event.chunk.totalChunks} (txs ${event.chunk.txStartIndex}..${event.chunk.txEndIndex}/${event.chunk.totalTransactions}, ${pct}%) | ${event.eventsParsedSoFar} events parsed so far`;
    }
    case "ingesting_batch": {
      const timingStr =
        event.durationMs !== undefined ? ` in ${event.durationMs}ms` : "";
      return `[Indexer Sync] [Page ${event.page}] Ingesting batch of ${event.batchSize} transactions (${event.insertedCount ?? 0} events inserted${timingStr}).`;
    }
    case "hydrating_draws": {
      return `[Indexer Sync] [Page ${event.page}] Hydrating pending draws triggered by batch...`;
    }
    case "reconciling_settlements": {
      return `[Indexer Sync] Reconciling Huma settlements for pool ${event.poolStateAddress}...`;
    }
    case "complete": {
      return `[Indexer Sync Complete] Synced ${event.totalPages} pages, scanned ${event.totalScanned} txs, ingested ${event.totalIngested} events.`;
    }
    case "aborted": {
      return `[Indexer Sync Aborted] [Page ${event.page}] Aborting sync: ${event.reason}`;
    }
  }
}

export interface SyncProgressTrackerOptions {
  silent?: boolean;
  onProgress?: (event: IndexerProgressEvent) => void;
}

export class SyncProgressTracker {
  private activeContext?: string;
  private readonly silent: boolean;
  private readonly onProgress?: (event: IndexerProgressEvent) => void;

  constructor(options?: SyncProgressTrackerOptions) {
    this.silent = !!options?.silent;
    this.onProgress = options?.onProgress;
  }

  getActiveContext(): string | undefined {
    return this.activeContext;
  }

  setActiveContext(context: string | undefined): void {
    this.activeContext = context;
  }

  emit(event: IndexerProgressEvent): void {
    switch (event.phase) {
      case "fetching_transactions":
        this.activeContext = `Page ${event.page} Chunk ${event.chunk.chunkNumber}/${event.chunk.totalChunks} (txs ${event.chunk.txStartIndex}..${event.chunk.txEndIndex}/${event.chunk.totalTransactions})`;
        break;
      case "querying_signatures":
        this.activeContext = `Page ${event.page} Signature Discovery`;
        break;
      case "ingesting_batch":
        this.activeContext = `Page ${event.page} Database Ingestion`;
        break;
      case "hydrating_draws":
        this.activeContext = `Page ${event.page} Draw Hydration`;
        break;
      case "reconciling_settlements":
        this.activeContext = `Settlement Reconciliation`;
        break;
      case "complete":
      case "aborted":
        this.activeContext = undefined;
        break;
    }

    if (this.onProgress) {
      this.onProgress(event);
    }

    if (!this.silent) {
      console.log(formatIndexerProgressMessage(event));
    }
  }

  createRetryListener(
    maxRetries: number,
    customOnRetry?: (
      error: unknown,
      attempt: number,
      delayMs: number,
      context?: string
    ) => void
  ): (error: unknown, attempt: number, delayMs: number) => void {
    return (error: unknown, attempt: number, delayMs: number) => {
      const contextPrefix = this.activeContext
        ? `[${this.activeContext}] `
        : "";
      if (!this.silent) {
        const cause = (error as { cause?: { message?: string } })?.cause;
        const msg =
          error instanceof Error
            ? cause?.message || error.message
            : String(error);
        console.warn(
          `[RPC Retry] ${contextPrefix}Transient RPC error (${msg}) on attempt ${attempt}/${maxRetries}. Retrying in ${Math.round(delayMs)}ms...`
        );
      }
      if (customOnRetry) {
        customOnRetry(error, attempt, delayMs, this.activeContext);
      }
    };
  }

  log(message: string, ...args: unknown[]): void {
    if (!this.silent) {
      console.log(message, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.silent) {
      console.warn(message, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.silent) {
      console.error(message, ...args);
    }
  }
}
