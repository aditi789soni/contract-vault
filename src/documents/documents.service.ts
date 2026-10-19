import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuditLogEvent } from '../audit/events/audit-log.event';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { UpdateDocumentMetadataDto } from './dto/update-document.dto';
import { ActiveUserPayload } from '../common/decorators/current-user.decorator';
import { TenantContext } from '../common/context/tenant.context';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Generates a tenant-namespaced S3/MinIO pre-signed PUT URL for uploading a contract.
   */
  async createUploadUrl(user: ActiveUserPayload, dto: RequestUploadUrlDto) {
    const sanitizedName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileKey = `tenants/${user.tenantId}/${uuidv4()}-${sanitizedName}`;

    return this.storageService.getPresignedUploadUrl(
      fileKey,
      dto.mimeType,
      900,
    );
  }

  /**
   * Confirms a completed S3/MinIO upload, persists metadata in PostgreSQL under RLS,
   * and records an immutable UPLOAD audit log entry.
   */
  async confirmUpload(
    user: ActiveUserPayload,
    dto: ConfirmUploadDto,
    ipAddress?: string,
  ) {
    const expectedPrefix = `tenants/${user.tenantId}/`;
    if (!dto.fileKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException(
        'Invalid fileKey namespace: fileKey must belong to the active tenant.',
      );
    }

    const document = await this.prisma.executeWithTenantRls(async (tx) => {
      return tx.document.create({
        data: {
          tenantId: user.tenantId,
          uploadedBy: user.sub,
          title: dto.title,
          fileKey: dto.fileKey,
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes,
          metadata: dto.metadata ?? {},
        },
      });
    }, user.tenantId);

    const clientIp = ipAddress || TenantContext.getIpAddress();
    await this.auditService.recordEvent(
      new AuditLogEvent(
        user.tenantId,
        user.sub,
        clientIp,
        'UPLOAD',
        document.id,
      ),
    );

    return document;
  }

  /**
   * Lists all documents visible to the current tenant (enforced via Postgres RLS).
   */
  async findAll(user: ActiveUserPayload) {
    return this.prisma.executeWithTenantRls(async (tx) => {
      return tx.document.findMany({
        orderBy: { createdAt: 'desc' },
      });
    }, user.tenantId);
  }

  /**
   * Retrieves a single document's metadata (enforcing Tenant RLS) and logs a VIEW action.
   */
  async findOne(user: ActiveUserPayload, id: string, ipAddress?: string) {
    const document = await this.prisma.executeWithTenantRls(async (tx) => {
      return tx.document.findUnique({
        where: { id },
      });
    }, user.tenantId);

    if (!document) {
      throw new NotFoundException(`Document with ID '${id}' not found`);
    }

    const clientIp = ipAddress || TenantContext.getIpAddress();
    await this.auditService.recordEvent(
      new AuditLogEvent(user.tenantId, user.sub, clientIp, 'VIEW', document.id),
    );

    return document;
  }

  /**
   * Generates a pre-signed GET URL valid for 5 minutes (300 seconds),
   * enforcing RBAC + Tenant RLS and recording an immutable DOWNLOAD audit log entry.
   */
  async getDownloadUrl(
    user: ActiveUserPayload,
    id: string,
    ipAddress?: string,
  ) {
    const document = await this.prisma.executeWithTenantRls(async (tx) => {
      return tx.document.findUnique({
        where: { id },
      });
    }, user.tenantId);

    if (!document) {
      throw new NotFoundException(`Document with ID '${id}' not found`);
    }

    const presigned = await this.storageService.getPresignedDownloadUrl(
      document.fileKey,
      300,
    );

    const clientIp = ipAddress || TenantContext.getIpAddress();
    await this.auditService.recordEvent(
      new AuditLogEvent(
        user.tenantId,
        user.sub,
        clientIp,
        'DOWNLOAD',
        document.id,
      ),
    );

    return {
      documentId: document.id,
      title: document.title,
      downloadUrl: presigned.downloadUrl,
      expiresIn: presigned.expiresIn,
    };
  }

  /**
   * Updates document title/metadata (Manager and Admin only).
   */
  async updateMetadata(
    user: ActiveUserPayload,
    id: string,
    dto: UpdateDocumentMetadataDto,
  ) {
    return this.prisma.executeWithTenantRls(async (tx) => {
      const existing = await tx.document.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException(`Document with ID '${id}' not found`);
      }

      return tx.document.update({
        where: { id },
        data: {
          title: dto.title ?? existing.title,
          metadata:
            dto.metadata !== undefined
              ? dto.metadata
              : (existing.metadata as any),
        },
      });
    }, user.tenantId);
  }

  /**
   * Deletes a document record and emits a tamper-proof DELETE audit log (Admin only).
   */
  async remove(user: ActiveUserPayload, id: string, ipAddress?: string) {
    const document = await this.prisma.executeWithTenantRls(async (tx) => {
      const existing = await tx.document.findUnique({
        where: { id },
      });

      if (!existing) {
        throw new NotFoundException(`Document with ID '${id}' not found`);
      }

      await tx.document.delete({
        where: { id },
      });

      return existing;
    }, user.tenantId);

    // Record tamper-proof DELETE audit log (document_id is null or preserved via SetNull if deleted)
    const clientIp = ipAddress || TenantContext.getIpAddress();
    await this.auditService.recordEvent(
      new AuditLogEvent(user.tenantId, user.sub, clientIp, 'DELETE', undefined),
    );

    return {
      deleted: true,
      id: document.id,
      title: document.title,
    };
  }
}
