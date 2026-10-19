import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { ActiveUserPayload } from '../common/decorators/current-user.decorator';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let prismaService: { executeWithTenantRls: jest.Mock };
  let storageService: {
    getPresignedUploadUrl: jest.Mock;
    getPresignedDownloadUrl: jest.Mock;
    deleteObject: jest.Mock;
  };
  let auditService: { recordEvent: jest.Mock };

  const mockManagerUser: ActiveUserPayload = {
    sub: 'user-manager-1',
    email: 'manager@acme.com',
    tenantId: '11111111-1111-1111-1111-111111111111',
    role: 'Manager',
  };

  beforeEach(async () => {
    prismaService = {
      executeWithTenantRls: jest.fn(),
    };
    storageService = {
      getPresignedUploadUrl: jest.fn(),
      getPresignedDownloadUrl: jest.fn(),
      deleteObject: jest.fn(),
    };
    auditService = {
      recordEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prismaService },
        { provide: StorageService, useValue: storageService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('should generate a tenant-scoped pre-signed PUT upload URL', async () => {
    storageService.getPresignedUploadUrl.mockResolvedValue({
      uploadUrl: 'http://minio:9000/contracts/presigned-put',
      fileKey: `tenants/${mockManagerUser.tenantId}/doc.pdf`,
      expiresIn: 900,
    });

    const result = await service.createUploadUrl(mockManagerUser, {
      fileName: 'nda contract.pdf',
      mimeType: 'application/pdf',
    });

    expect(storageService.getPresignedUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining(`tenants/${mockManagerUser.tenantId}/`),
      'application/pdf',
      900,
    );
    expect(result.uploadUrl).toContain('presigned-put');
  });

  it('should reject confirmUpload if fileKey does not match active tenant namespace', async () => {
    await expect(
      service.confirmUpload(mockManagerUser, {
        title: 'Cross-Tenant Spoofed Contract',
        fileKey: 'tenants/99999999-9999-9999-9999-999999999999/spoof.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should confirm upload within RLS context and emit UPLOAD audit log', async () => {
    const mockDoc = {
      id: 'doc-uuid-1',
      tenantId: mockManagerUser.tenantId,
      uploadedBy: mockManagerUser.sub,
      title: 'MSA 2026',
      fileKey: `tenants/${mockManagerUser.tenantId}/msa.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 20480,
      metadata: {},
    };

    prismaService.executeWithTenantRls.mockImplementation(async (cb) =>
      cb({
        document: {
          create: jest.fn().mockResolvedValue(mockDoc),
        },
      }),
    );

    const result = await service.confirmUpload(
      mockManagerUser,
      {
        title: 'MSA 2026',
        fileKey: `tenants/${mockManagerUser.tenantId}/msa.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 20480,
      },
      '10.0.0.15',
    );

    expect(result).toEqual(mockDoc);
    expect(auditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: mockManagerUser.tenantId,
        userId: mockManagerUser.sub,
        action: 'UPLOAD',
        documentId: 'doc-uuid-1',
        ipAddress: '10.0.0.15',
      }),
    );
  });

  it('should generate a 5-minute pre-signed GET URL and emit DOWNLOAD audit log', async () => {
    const mockDoc = {
      id: 'doc-uuid-2',
      tenantId: mockManagerUser.tenantId,
      title: 'Enterprise SLA',
      fileKey: `tenants/${mockManagerUser.tenantId}/sla.pdf`,
    };

    prismaService.executeWithTenantRls.mockImplementation(async (cb) =>
      cb({
        document: {
          findUnique: jest.fn().mockResolvedValue(mockDoc),
        },
      }),
    );

    storageService.getPresignedDownloadUrl.mockResolvedValue({
      downloadUrl: 'http://minio:9000/contracts/presigned-get',
      expiresIn: 300,
    });

    const result = await service.getDownloadUrl(
      mockManagerUser,
      'doc-uuid-2',
      '192.168.1.20',
    );

    expect(result.expiresIn).toBe(300);
    expect(result.downloadUrl).toBe(
      'http://minio:9000/contracts/presigned-get',
    );
    expect(auditService.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: mockManagerUser.tenantId,
        userId: mockManagerUser.sub,
        action: 'DOWNLOAD',
        documentId: 'doc-uuid-2',
        ipAddress: '192.168.1.20',
      }),
    );
  });

  it('should throw NotFoundException when document does not exist in tenant RLS scope', async () => {
    prismaService.executeWithTenantRls.mockImplementation(async (cb) =>
      cb({
        document: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      }),
    );

    await expect(
      service.getDownloadUrl(mockManagerUser, 'missing-doc-id'),
    ).rejects.toThrow(NotFoundException);
  });
});
