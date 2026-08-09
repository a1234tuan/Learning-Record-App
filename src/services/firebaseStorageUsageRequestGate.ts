export interface StorageUsageRequestKey {
  uid: string;
  generation: number;
}

const keyFor = ({ uid, generation }: StorageUsageRequestKey) => `${uid}:${generation}`;

/** Prevents duplicate measurements while still allowing a new account generation to proceed. */
export class FirebaseStorageUsageRequestGate {
  private readonly activeKeys = new Set<string>();

  begin(request: StorageUsageRequestKey): boolean {
    const key = keyFor(request);
    if (this.activeKeys.has(key)) return false;
    this.activeKeys.add(key);
    return true;
  }

  end(request: StorageUsageRequestKey): void {
    this.activeKeys.delete(keyFor(request));
  }
}
