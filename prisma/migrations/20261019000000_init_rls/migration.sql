-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Enums
CREATE TYPE "Role" AS ENUM ('Viewer', 'Manager', 'Admin');
CREATE TYPE "AuditAction" AS ENUM ('UPLOAD', 'DOWNLOAD', 'VIEW', 'DELETE');

-- 1. Create Tenants Table
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenants_name_key" ON "tenants"("name");
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");

-- 2. Create Users Table
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'Viewer',
    "refresh_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- 3. Create Documents Table
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "tenant_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "documents_file_key_key" ON "documents"("file_key");
CREATE INDEX "documents_tenant_id_idx" ON "documents"("tenant_id");

-- 4. Create Tamper-Proof Audit Logs Table
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ip_address" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "document_id" UUID,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_logs_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_tenant_id_timestamp_idx" ON "audit_logs"("tenant_id", "timestamp");

-- ============================================================================
-- NATIVE POSTGRESQL ROW-LEVEL SECURITY (RLS) & TAMPER-PROOF POLICIES
-- ============================================================================

-- Helper function to retrieve current session tenant_id safely
CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS UUID AS $$
DECLARE
    tenant_val TEXT;
BEGIN
    tenant_val := current_setting('app.current_tenant_id', true);
    IF tenant_val IS NULL OR tenant_val = '' THEN
        RETURN NULL;
    END IF;
    RETURN tenant_val::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Enable and Force RLS on Tenant-Scoped Tables
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

-- RLS Policies: Tenants can NEVER access or mutate records belonging to another tenant_id
CREATE POLICY "tenant_isolation_policy" ON "tenants"
    USING ("id" = current_app_tenant_id())
    WITH CHECK ("id" = current_app_tenant_id());

CREATE POLICY "user_tenant_isolation_policy" ON "users"
    USING ("tenant_id" = current_app_tenant_id())
    WITH CHECK ("tenant_id" = current_app_tenant_id());

CREATE POLICY "document_tenant_isolation_policy" ON "documents"
    USING ("tenant_id" = current_app_tenant_id())
    WITH CHECK ("tenant_id" = current_app_tenant_id());

CREATE POLICY "audit_log_tenant_isolation_policy" ON "audit_logs"
    FOR SELECT
    USING ("tenant_id" = current_app_tenant_id());

CREATE POLICY "audit_log_insert_policy" ON "audit_logs"
    FOR INSERT
    WITH CHECK ("tenant_id" = current_app_tenant_id());

-- Tamper-Proof Trigger: Prevent UPDATE or DELETE on audit_logs
CREATE OR REPLACE FUNCTION prevent_audit_log_tampering() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_immutable_audit_logs"
    BEFORE UPDATE OR DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_tampering();

-- Create dedicated non-superuser application role so RLS policies are strictly enforced
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN PASSWORD 'app_password';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
