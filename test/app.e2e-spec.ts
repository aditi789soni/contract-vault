import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

/**
 * Stateful Row-Level Security (RLS) Simulator for E2E verification.
 * Emulates PostgreSQL 16 `SET LOCAL app.current_tenant_id = :tenantId` and RLS policies
 * (`tenant_id = current_app_tenant_id()`) so E2E tests deterministically verify
 * multi-tenant isolation, RBAC enforcement, and tamper-proof audit logging in any environment.
 */
class RlsDatabaseSimulator {
  tenants: any[] = [];
  users: any[] = [];
  documents: any[] = [];
  auditLogs: any[] = [];

  createScopedClient(activeTenantId: string) {
    return {
      $executeRaw: jest.fn().mockResolvedValue(1),
      tenant: {
        create: async ({ data }: any) => {
          if (data.id && data.id !== activeTenantId) {
            throw new Error(
              'new row violates row-level security policy for table "tenants"',
            );
          }
          if (this.tenants.some((t) => t.name === data.name)) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          const rec = {
            id: data.id || uuidv4(),
            name: data.name,
            domain: data.domain ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.tenants.push(rec);
          return rec;
        },
      },
      user: {
        create: async ({ data }: any) => {
          if (data.tenantId !== activeTenantId) {
            throw new Error(
              'new row violates row-level security policy for table "users"',
            );
          }
          if (this.users.some((u) => u.email === data.email)) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            throw err;
          }
          const rec = {
            id: data.id || uuidv4(),
            tenantId: data.tenantId,
            email: data.email,
            passwordHash: data.passwordHash,
            role: data.role || 'Viewer',
            refreshTokenHash: data.refreshTokenHash ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.users.push(rec);
          return rec;
        },
        findUnique: async ({ where }: any) => {
          return (
            this.users.find(
              (u) =>
                u.tenantId === activeTenantId &&
                ((where.id && u.id === where.id) ||
                  (where.email && u.email === where.email)),
            ) || null
          );
        },
        findMany: async () => {
          return this.users.filter((u) => u.tenantId === activeTenantId);
        },
        update: async ({ where, data }: any) => {
          const user = this.users.find(
            (u) => u.id === where.id && u.tenantId === activeTenantId,
          );
          if (!user) {
            throw new Error('Record to update not found in RLS scope.');
          }
          Object.assign(user, data, { updatedAt: new Date() });
          return user;
        },
      },
      document: {
        create: async ({ data }: any) => {
          if (data.tenantId !== activeTenantId) {
            throw new Error(
              'new row violates row-level security policy for table "documents"',
            );
          }
          const rec = {
            id: uuidv4(),
            tenantId: data.tenantId,
            uploadedBy: data.uploadedBy,
            title: data.title,
            fileKey: data.fileKey,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            metadata: data.metadata || {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.documents.push(rec);
          return rec;
        },
        findMany: async () => {
          // Strictly filtered by activeTenantId (Postgres RLS Policy)
          return this.documents.filter((d) => d.tenantId === activeTenantId);
        },
        findUnique: async ({ where }: any) => {
          // Strictly filtered by activeTenantId (Postgres RLS Policy)
          return (
            this.documents.find(
              (d) => d.id === where.id && d.tenantId === activeTenantId,
            ) || null
          );
        },
        update: async ({ where, data }: any) => {
          const doc = this.documents.find(
            (d) => d.id === where.id && d.tenantId === activeTenantId,
          );
          if (!doc) {
            throw new Error('Document not found in RLS scope');
          }
          Object.assign(doc, data, { updatedAt: new Date() });
          return doc;
        },
        delete: async ({ where }: any) => {
          const idx = this.documents.findIndex(
            (d) => d.id === where.id && d.tenantId === activeTenantId,
          );
          if (idx === -1) {
            throw new Error('Document not found in RLS scope');
          }
          const [deleted] = this.documents.splice(idx, 1);
          return deleted;
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          if (data.tenantId !== activeTenantId) {
            throw new Error(
              'new row violates row-level security policy for table "audit_logs"',
            );
          }
          const rec = {
            id: uuidv4(),
            timestamp: new Date(),
            tenantId: data.tenantId,
            userId: data.userId,
            ipAddress: data.ipAddress,
            action: data.action,
            documentId: data.documentId ?? null,
          };
          this.auditLogs.push(rec);
          return rec;
        },
        findMany: async () => {
          return this.auditLogs.filter((a) => a.tenantId === activeTenantId);
        },
      },
    };
  }
}

describe('Multi-Tenant Contract Portal (E2E)', () => {
  let app: INestApplication;
  let dbSim: RlsDatabaseSimulator;

  let tenantAAdminToken: string;
  let tenantAViewerToken: string;
  let tenantAId: string;
  let tenantADocumentId: string;
  let tenantAFileKey: string;

  let tenantBAdminToken: string;

  beforeAll(async () => {
    dbSim = new RlsDatabaseSimulator();

    const mockPrismaService = {
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      user: {
        findUnique: jest.fn(async ({ where }: any) => {
          return dbSim.users.find((u) => u.email === where.email) || null;
        }),
      },
      executeWithTenantRls: jest.fn(
        async (callback: any, explicitTenantId?: string) => {
          if (!explicitTenantId) {
            throw new Error('Missing Tenant ID for RLS');
          }
          const scopedTx = dbSim.createScopedClient(explicitTenantId);
          return callback(scopedTx);
        },
      ),
    };

    const mockStorageService = {
      getPresignedUploadUrl: jest.fn(async (fileKey: string) => ({
        uploadUrl: `http://localhost:9000/contracts/${fileKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900`,
        fileKey,
        expiresIn: 900,
      })),
      getPresignedDownloadUrl: jest.fn(
        async (fileKey: string, expiresIn = 300) => ({
          downloadUrl: `http://localhost:9000/contracts/${fileKey}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=${expiresIn}`,
          expiresIn,
        }),
      ),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .overrideProvider(StorageService)
      .useValue(mockStorageService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Registers Tenant A (Acme Corp) and Tenant B (Globex Corp)', async () => {
    const resA = await request(app.getHttpServer())
      .post('/api/v1/auth/register-tenant')
      .send({
        tenantName: 'Acme Corp',
        domain: 'acme.com',
        adminEmail: 'admin@acme.com',
        adminPassword: 'Password123!',
      })
      .expect(201);

    expect(resA.body.accessToken).toBeDefined();
    expect(resA.body.refreshToken).toBeDefined();
    expect(resA.body.user.role).toBe('Admin');

    tenantAAdminToken = resA.body.accessToken;
    tenantAId = resA.body.tenant.id;

    const resB = await request(app.getHttpServer())
      .post('/api/v1/auth/register-tenant')
      .send({
        tenantName: 'Globex Corp',
        domain: 'globex.com',
        adminEmail: 'admin@globex.com',
        adminPassword: 'Password123!',
      })
      .expect(201);

    tenantBAdminToken = resB.body.accessToken;
    expect(resB.body.tenant.id).not.toEqual(tenantAId);
  });

  it('2. Tenant A Admin invites a Viewer user and Viewer logs in', async () => {
    const inviteRes = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${tenantAAdminToken}`)
      .send({
        email: 'viewer@acme.com',
        role: 'Viewer',
        temporaryPassword: 'ViewerPassword123!',
      })
      .expect(201);

    expect(inviteRes.body.role).toBe('Viewer');
    expect(inviteRes.body.tenantId).toBe(tenantAId);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'viewer@acme.com',
        password: 'ViewerPassword123!',
      })
      .expect(200);

    tenantAViewerToken = loginRes.body.accessToken;
    expect(tenantAViewerToken).toBeDefined();
  });

  it('3. Tenant A Admin uploads and confirms a confidential contract via Pre-Signed URL', async () => {
    const uploadUrlRes = await request(app.getHttpServer())
      .post('/api/v1/documents/upload-url')
      .set('Authorization', `Bearer ${tenantAAdminToken}`)
      .send({
        fileName: 'acme-secret-merger.pdf',
        mimeType: 'application/pdf',
      })
      .expect(201);

    expect(uploadUrlRes.body.uploadUrl).toContain(
      'http://localhost:9000/contracts/',
    );
    expect(uploadUrlRes.body.fileKey).toContain(`tenants/${tenantAId}/`);
    tenantAFileKey = uploadUrlRes.body.fileKey;

    const confirmRes = await request(app.getHttpServer())
      .post('/api/v1/documents/confirm')
      .set('Authorization', `Bearer ${tenantAAdminToken}`)
      .send({
        title: 'Acme Confidential Merger Agreement',
        fileKey: tenantAFileKey,
        mimeType: 'application/pdf',
        sizeBytes: 512000,
        metadata: { classification: 'Top Secret' },
      })
      .expect(201);

    tenantADocumentId = confirmRes.body.id;
    expect(tenantADocumentId).toBeDefined();
    expect(confirmRes.body.tenantId).toBe(tenantAId);
  });

  it('4. [RLS Verification] Tenant B CANNOT access, view, download, or list Tenant A documents', async () => {
    // Tenant B lists documents -> receives empty list
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/documents')
      .set('Authorization', `Bearer ${tenantBAdminToken}`)
      .expect(200);

    expect(listRes.body).toEqual([]);

    // Tenant B attempts to fetch Tenant A's document by ID -> 404 Not Found due to RLS isolation
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${tenantADocumentId}`)
      .set('Authorization', `Bearer ${tenantBAdminToken}`)
      .expect(404);

    // Tenant B attempts to generate download URL for Tenant A's document -> 404 Not Found
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${tenantADocumentId}/download-url`)
      .set('Authorization', `Bearer ${tenantBAdminToken}`)
      .expect(404);
  });

  it('5. [RBAC Verification] Viewer CANNOT trigger document deletion or upload', async () => {
    // Viewer attempts to delete Tenant A's document -> 403 Forbidden
    await request(app.getHttpServer())
      .delete(`/api/v1/documents/${tenantADocumentId}`)
      .set('Authorization', `Bearer ${tenantAViewerToken}`)
      .expect(403);

    // Viewer attempts to request upload URL -> 403 Forbidden
    await request(app.getHttpServer())
      .post('/api/v1/documents/upload-url')
      .set('Authorization', `Bearer ${tenantAViewerToken}`)
      .send({
        fileName: 'unauthorized.pdf',
        mimeType: 'application/pdf',
      })
      .expect(403);
  });

  it('6. [Audit Log Verification] Audit log entry is generated on document download', async () => {
    // Viewer is permitted to download within Tenant A
    const downloadRes = await request(app.getHttpServer())
      .get(`/api/v1/documents/${tenantADocumentId}/download-url`)
      .set('Authorization', `Bearer ${tenantAViewerToken}`)
      .expect(200);

    expect(downloadRes.body.downloadUrl).toContain(tenantAFileKey);
    expect(downloadRes.body.expiresIn).toBe(300);

    // Admin fetches Tenant A audit logs
    const auditRes = await request(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${tenantAAdminToken}`)
      .expect(200);

    expect(Array.isArray(auditRes.body)).toBe(true);

    const downloadLog = auditRes.body.find(
      (log: any) =>
        log.action === 'DOWNLOAD' && log.documentId === tenantADocumentId,
    );
    expect(downloadLog).toBeDefined();
    expect(downloadLog.tenantId).toBe(tenantAId);

    const uploadLog = auditRes.body.find(
      (log: any) =>
        log.action === 'UPLOAD' && log.documentId === tenantADocumentId,
    );
    expect(uploadLog).toBeDefined();
  });
});
