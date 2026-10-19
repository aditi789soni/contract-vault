# ContractVault — Multi-Tenant Enterprise Document & Contract Management Portal

[![CI Pipeline](https://github.com/aditi789soni/contract-vault/actions/workflows/ci.yml/badge.svg)](https://github.com/aditi789soni/contract-vault/actions)
![Node.js 20](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js)
![NestJS 10](https://img.shields.io/badge/NestJS-10.x-E0234E?logo=nestjs)
![PostgreSQL 16 RLS](https://img.shields.io/badge/PostgreSQL_16-Native_RLS-4169E1?logo=postgresql)
![AWS S3 / MinIO](https://img.shields.io/badge/Storage-S3_%2F_MinIO-FF9900?logo=amazon-s3)

**ContractVault** is an enterprise-grade, production-ready **Multi-Tenant Document & Contract Management Portal** engineered with **NestJS (TypeScript)**, **PostgreSQL 16 Native Row-Level Security (RLS)**, **Prisma ORM**, **AWS S3 / MinIO Pre-Signed URLs**, **JWT Access + Refresh Token Rotation**, **Role-Based Access Control (RBAC)**, and **Tamper-Proof Audit Logging**.

---

## System Architecture

### Mermaid Architectural Diagram

```mermaid
flowchart TD
    Client["Enterprise Client / SPA"] -->|Bearer JWT| API["NestJS API Gateway (/api/v1)"]

    subgraph SecurityLayer ["Zero-Trust Security & Context Pipeline"]
        JWTGuard["JwtAuthGuard (Passport.js)"]
        RBACGuard["RolesGuard (@Roles: Admin | Manager | Viewer)"]
        RLSInterceptor["TenantRlsInterceptor (AsyncLocalStorage Context)"]
    end

    API --> JWTGuard --> RBACGuard --> RLSInterceptor

    subgraph DomainModules ["Clean Architecture Domain Modules"]
        AuthMod["AuthModule (Token Rotation & Bcrypt)"]
        UserMod["UsersModule (Tenant Invites)"]
        DocMod["DocumentsModule (Pre-signed Orchestration)"]
        AuditMod["AuditModule (EventEmitter2 Tamper-Proof Logs)"]
    end

    RLSInterceptor --> AuthMod
    RLSInterceptor --> UserMod
    RLSInterceptor --> DocMod
    DocMod -->|emitAsync('audit.log')| AuditMod

    subgraph DataLayer ["Persistence & Object Storage"]
        PrismaRLS["PrismaService.$transaction\nSET LOCAL app.current_tenant_id = :tenantId"]
        PG[("PostgreSQL 16\nFORCE ROW LEVEL SECURITY\n+ Immutable Audit Trigger")]
        S3[("AWS S3 / MinIO\nBucket: contracts\n5-Min Pre-Signed URLs")]
    end

    AuthMod --> PrismaRLS
    UserMod --> PrismaRLS
    DocMod --> PrismaRLS
    AuditMod --> PrismaRLS
    PrismaRLS --> PG

    DocMod -->|@aws-sdk/s3-request-presigner| S3
    Client -.->|Direct PUT / GET via Pre-Signed URL| S3
```

### ASCII Architecture Overview

```text
+-------------------------------------------------------------------------+
|                        ENTERPRISE CLIENT / CALLER                       |
+------------------------------------+------------------------------------+
                                     |
                   1. Bearer JWT     |     4. Direct PUT/GET Binary Stream
                                     v        (5-Min Pre-Signed S3 URL)
+------------------------------------+------------------------------------+
|                      NESTJS 10 APPLICATION SERVER                       |
|                                                                         |
|  [JwtAuthGuard] ---> [RolesGuard (@Roles)] ---> [TenantRlsInterceptor]  |
|                                                          |              |
|  +------------------+  +-------------------+  +----------v-----------+  |
|  |   AuthService    |  |   UsersService    |  |   DocumentsService   |  |
|  | (Refresh Rotate) |  |  (Admin Invites)  |  | (S3 Signer + Audit)  |  |
|  +--------+---------+  +---------+---------+  +----+------------+----+  |
|           |                      |                 |            |       |
|           |                      |        emitAsync|            |Sign   |
|           |                      |        (Audit)  v            |URL    |
|           |                      |         +-------+--------+   |       |
|           |                      |         |  AuditService  |   |       |
|           +----------------------+---------+-------+--------+   |       |
|                                  |                 |            |       |
|                                  v                 v            |       |
|           +-------------------------------------------------+   |       |
|           |       PrismaService.executeWithTenantRls()      |   |       |
|           |   SET LOCAL app.current_tenant_id = :tenantId   |   |       |
|           +----------------------+--------------------------+   |       |
+----------------------------------|------------------------------|-------+
                                   |                              |
                                   v                              v
+----------------------------------+---+    +---------------------+-------+
|        POSTGRESQL 16 DATABASE        |    |   MINIO / AWS S3 STORAGE    |
|  - FORCE ROW LEVEL SECURITY (RLS)    |    |  - Bucket: `contracts`      |
|  - Policies on tenants, users,       |    |  - Key Isolation:           |
|    documents, audit_logs             |    |    tenants/{tenantId}/{id}  |
|  - Trigger: trg_immutable_audit_logs |    +-----------------------------+
+--------------------------------------+
```

---

## Key Enterprise Capabilities

1. **Multi-Tenancy via Native PostgreSQL 16 Row-Level Security (RLS)**:
   - Tables (`tenants`, `users`, `documents`, `audit_logs`) have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` enabled at the database engine level.
   - Every tenant-scoped database operation executes inside a transaction via `PrismaService.executeWithTenantRls`, which runs `SELECT set_config('app.current_tenant_id', :tenantId, true)` (`SET LOCAL app.current_tenant_id`).
   - Even if an application query omits a `WHERE tenant_id = ...` clause, PostgreSQL natively blocks cross-tenant reads or writes.

2. **Role-Based Access Control (RBAC)**:
   - Declarative `@Roles('Admin', 'Manager', 'Viewer')` decorator paired with `RolesGuard`:
     - **`Viewer`**: Read-only access to list, inspect, and download tenant contracts.
     - **`Manager`**: All `Viewer` permissions + generate upload pre-signed URLs, confirm uploads, and update contract metadata.
     - **`Admin`**: All `Manager` permissions + invite users with roles (`POST /api/v1/users/invite`), delete contracts (`DELETE /api/v1/documents/:id`), and inspect tamper-proof audit logs (`GET /api/v1/audit-logs`).

3. **Zero-Bottleneck Object Storage (AWS S3 / MinIO Pre-Signed URLs)**:
   - Contract binaries never buffer through the Node.js event loop.
   - Upload flow: `POST /api/v1/documents/upload-url` returns a tenant-namespaced (`tenants/{tenantId}/{uuid}-{filename}`) S3 pre-signed `PUT` URL, followed by `POST /api/v1/documents/confirm` to persist metadata in PostgreSQL.
   - Download flow: `GET /api/v1/documents/:id/download-url` verifies both RBAC and Tenant RLS before issuing a 5-minute (`expiresIn: 300`) pre-signed `GET` URL.

4. **Tamper-Proof Audit Trail**:
   - Every `UPLOAD`, `DOWNLOAD`, `VIEW`, and `DELETE` operation emits a synchronous/awaited domain event (`audit.log`) via `@nestjs/event-emitter` so audit logging never fails silently.
   - Protected at the PostgreSQL layer by an `INSERT`-only RLS policy and a `BEFORE UPDATE OR DELETE` trigger (`prevent_audit_log_tampering()`) that raises a hard exception if anyone attempts to alter or delete historical logs.

---

## API Reference

Interactive Swagger / OpenAPI 3.0 documentation is mounted automatically at:
**`http://localhost:3000/api/docs`**

| Method | Endpoint | Roles Allowed | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register-tenant` | Public | Registers a new company (`Tenant`) and initial `Admin` user, returning Access + Refresh tokens. |
| `POST` | `/api/v1/auth/login` | Public | Authenticates user credentials and returns a fresh Access + Refresh JWT pair. |
| `POST` | `/api/v1/auth/refresh` | Public (Refresh Token) | Validates and rotates the refresh token, revoking the old hash. |
| `POST` | `/api/v1/users/invite` | `Admin` | Invites a new user into the active tenant with a specified role (`Viewer`, `Manager`, `Admin`). |
| `GET` | `/api/v1/users` | `Admin`, `Manager` | Lists all users belonging to the active tenant. |
| `POST` | `/api/v1/documents/upload-url` | `Admin`, `Manager` | Generates a pre-signed S3/MinIO `PUT` URL scoped to the tenant namespace. |
| `POST` | `/api/v1/documents/confirm` | `Admin`, `Manager` | Confirms file upload, stores metadata in Postgres under RLS, and records `UPLOAD` audit log. |
| `GET` | `/api/v1/documents` | `Admin`, `Manager`, `Viewer` | Lists all documents in the active tenant (isolated by Postgres RLS). |
| `GET` | `/api/v1/documents/:id` | `Admin`, `Manager`, `Viewer` | Retrieves contract metadata by ID and records a `VIEW` audit log. |
| `GET` | `/api/v1/documents/:id/download-url` | `Admin`, `Manager`, `Viewer` | Generates a 5-minute pre-signed `GET` URL and records a `DOWNLOAD` audit log. |
| `PATCH` | `/api/v1/documents/:id` | `Admin`, `Manager` | Updates contract title and JSONB metadata. |
| `DELETE` | `/api/v1/documents/:id` | `Admin` | Deletes a contract record and records a `DELETE` audit log. |
| `GET` | `/api/v1/audit-logs` | `Admin` | Retrieves immutable audit logs for the active tenant. |

---

## Quickstart & Local Setup

### 1. Run the Full Stack with Docker Compose (Recommended)

Docker Compose orchestrates **PostgreSQL 16** (pre-loaded with the native RLS migration and triggers), **MinIO** (with an automatic init container that provisions the `contracts` bucket), and the **NestJS API**.

```bash
cp .env.example .env
docker compose up --build -d
```

- **API Base URL**: `http://localhost:3000`
- **Swagger UI**: `http://localhost:3000/api/docs`
- **MinIO Console**: `http://localhost:9001` (`minioadmin` / `minioadmin`)

### 2. Local Development & Testing

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run ESLint
npm run lint

# Run Unit Tests (Services & RBAC Guards)
npm test

# Run E2E Integration Suite (Verifies Cross-Tenant RLS, RBAC, and Audit Logs)
npm run test:e2e
```

---

## ATS Keyword Summary

**Languages & Frameworks**: TypeScript, Node.js, NestJS, Express.js, SQL, PL/pgSQL  
**Database & Multi-Tenancy**: PostgreSQL 16, Row-Level Security (RLS), Session Context Switching (`SET LOCAL`), Prisma ORM, Database Triggers, ACID Transactions, JSONB, Multi-Tenant SaaS Architecture  
**Cloud & Object Storage**: AWS SDK v3 (`@aws-sdk/client-s3`), S3 Pre-Signed URLs (`@aws-sdk/s3-request-presigner`), MinIO Object Storage  
**Authentication & Security**: JWT (JSON Web Tokens), Refresh Token Rotation, Passport.js, Role-Based Access Control (RBAC), Custom Guards & Interceptors, Bcrypt Password Hashing, AsyncLocalStorage, Tamper-Proof Audit Logging  
**DevOps, Testing & Tooling**: Docker, Docker Compose, GitHub Actions CI/CD, Jest, Supertest (E2E & Integration Testing), OpenAPI / Swagger, ESLint, Prettier, Clean Architecture
