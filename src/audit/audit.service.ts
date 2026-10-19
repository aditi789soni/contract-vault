import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AUDIT_LOG_EVENT, AuditLogEvent } from './events/audit-log.event';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Emits an audit event and awaits all listeners to guarantee tamper-proof,
   * non-silent persistence within the tenant RLS context.
   */
  async recordEvent(event: AuditLogEvent): Promise<void> {
    await this.eventEmitter.emitAsync(AUDIT_LOG_EVENT, event);
  }

  @OnEvent(AUDIT_LOG_EVENT)
  async handleAuditLogEvent(event: AuditLogEvent) {
    try {
      return await this.prisma.executeWithTenantRls(async (tx) => {
        return tx.auditLog.create({
          data: {
            tenantId: event.tenantId,
            userId: event.userId,
            ipAddress: event.ipAddress,
            action: event.action,
            documentId: event.documentId ?? null,
          },
        });
      }, event.tenantId);
    } catch (error) {
      this.logger.error(
        `CRITICAL: Failed to persist tamper-proof audit log for tenant ${event.tenantId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Retrieves immutable audit logs for the current tenant (Admin only).
   */
  async findAllForTenant(tenantId?: string) {
    return this.prisma.executeWithTenantRls(async (tx) => {
      return tx.auditLog.findMany({
        orderBy: { timestamp: 'desc' },
      });
    }, tenantId);
  }
}
