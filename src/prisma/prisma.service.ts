import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TenantContext } from '../common/context/tenant.context';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Executes a callback inside a PostgreSQL transaction with session-based
   * Row-Level Security (RLS) context configured via:
   * SET LOCAL app.current_tenant_id = :tenantId
   */
  async executeWithTenantRls<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    explicitTenantId?: string,
  ): Promise<T> {
    const tenantId = explicitTenantId || TenantContext.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException(
        'Tenant RLS context is missing. Operation rejected.',
      );
    }

    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return callback(tx);
    });
  }
}
