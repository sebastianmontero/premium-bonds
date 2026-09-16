import type { DbAggregationClient } from "../pool-stats-aggregator";

export type AggregationRow = {
  status: string;
  count: number | string;
  totalDistributed: string | number | null;
  totalWinningBonds: number | string | null;
};

export interface MockAggregationDbOptions {
  rows?: AggregationRow[] | ((callIndex: number) => AggregationRow[]);
  error?: Error | ((callIndex: number) => Error | undefined);
  execute?: (callIndex: number) => Promise<AggregationRow[]> | AggregationRow[];
  delayMs?: number;
  onQuery?: (callIndex: number) => void;
}

export function createMockAggregationDb(
  options: MockAggregationDbOptions = {}
): DbAggregationClient {
  let callCount = 0;

  const execute = async (): Promise<AggregationRow[]> => {
    const currentCall = callCount++;
    options.onQuery?.(currentCall);

    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    if (options.execute) {
      return options.execute(currentCall);
    }

    const dynamicError =
      typeof options.error === "function"
        ? options.error(currentCall)
        : options.error;
    if (dynamicError) throw dynamicError;

    if (typeof options.rows === "function") {
      return options.rows(currentCall);
    }
    return options.rows ?? [];
  };

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: () => execute(),
          then: (
            resolve?: (value: unknown) => unknown,
            reject?: (reason?: unknown) => unknown
          ) => execute().then(resolve, reject),
        }),
        groupBy: () => execute(),
      }),
    }),
  };
}
