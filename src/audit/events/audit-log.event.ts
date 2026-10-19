export type AuditActionType = 'UPLOAD' | 'DOWNLOAD' | 'VIEW' | 'DELETE';

export const AUDIT_LOG_EVENT = 'audit.log';

export class AuditLogEvent {
  constructor(
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly ipAddress: string,
    public readonly action: AuditActionType,
    public readonly documentId?: string,
  ) {}
}
