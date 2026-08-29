export interface ILeaderLock {
  acquire(): Promise<boolean>;
  renew(): Promise<boolean>;
  release(): Promise<void>;
  isLeader(): boolean;
}

export class LocalLeaderLock implements ILeaderLock {
  private leader = false;

  async acquire(): Promise<boolean> {
    this.leader = true;
    return true;
  }

  async renew(): Promise<boolean> {
    return this.leader;
  }

  async release(): Promise<void> {
    this.leader = false;
  }

  isLeader(): boolean {
    return this.leader;
  }
}

export class DatabaseLeaderLock implements ILeaderLock {
  private leader = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly instanceId: string,
    private readonly ttlSeconds = 15
  ) {}

  async acquire(): Promise<boolean> {
    // In local/single node, behaves as leader
    this.leader = true;
    return true;
  }

  async renew(): Promise<boolean> {
    return this.leader;
  }

  async release(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.leader = false;
  }

  isLeader(): boolean {
    return this.leader;
  }
}

export function createLeaderLock(
  type: "local" | "database" = "local"
): ILeaderLock {
  if (type === "database") {
    const instanceId = `crank-${process.pid}-${Date.now()}`;
    return new DatabaseLeaderLock(instanceId);
  }
  return new LocalLeaderLock();
}
