import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  tenantId: string;
  userId?: string;
  role?: string;
  ipAddress?: string;
}

export const tenantAsyncStorage = new AsyncLocalStorage<TenantStore>();

export class TenantContext {
  static run<T>(store: TenantStore, callback: () => T): T {
    return tenantAsyncStorage.run(store, callback);
  }

  static getStore(): TenantStore | undefined {
    return tenantAsyncStorage.getStore();
  }

  static getTenantId(): string | undefined {
    return tenantAsyncStorage.getStore()?.tenantId;
  }

  static getUserId(): string | undefined {
    return tenantAsyncStorage.getStore()?.userId;
  }

  static getIpAddress(): string {
    return tenantAsyncStorage.getStore()?.ipAddress || '127.0.0.1';
  }
}
