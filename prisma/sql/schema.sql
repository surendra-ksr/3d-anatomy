-- ---------------------------------------------------------------------------
-- Interactive Anatomy Engine - PostgreSQL DDL
--
-- Hand-maintained to mirror prisma/schema.prisma exactly. Applied by
-- scripts/db_init.py (idempotent). We apply DDL directly instead of
-- `prisma db push` because the schema-engine binary is unavailable in
-- engine-free (WASM query compiler) deployments.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "Laterality" AS ENUM ('LEFT', 'RIGHT', 'MIDLINE', 'PAIRED');
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "anatomical_systems" (
    "id"        SERIAL NOT NULL,
    "fmaId"     TEXT   NOT NULL,
    "key"       TEXT   NOT NULL,
    "name"      TEXT   NOT NULL,
    "color"     TEXT   NOT NULL DEFAULT '#888888',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "anatomical_systems_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "anatomical_systems" ADD CONSTRAINT "anatomical_systems_fmaId_key" UNIQUE ("fmaId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "anatomical_systems" ADD CONSTRAINT "anatomical_systems_key_key" UNIQUE ("key");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "organs" (
    "id"         SERIAL NOT NULL,
    "fmaId"      TEXT   NOT NULL,
    "bp3dId"     TEXT,
    "name"       TEXT   NOT NULL,
    "laterality" "Laterality" NOT NULL DEFAULT 'MIDLINE',
    "systemId"   INTEGER NOT NULL,
    "parentId"   INTEGER,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organs_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "organs" ADD CONSTRAINT "organs_fmaId_key" UNIQUE ("fmaId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "organs_systemId_idx" ON "organs"("systemId");
CREATE INDEX IF NOT EXISTS "organs_parentId_idx" ON "organs"("parentId");

CREATE TABLE IF NOT EXISTS "mesh_assets" (
    "id"            SERIAL NOT NULL,
    "organId"       INTEGER NOT NULL,
    "url"           TEXT   NOT NULL,
    "nodePath"      TEXT   NOT NULL,
    "groupKey"      TEXT   NOT NULL,
    "format"        TEXT   NOT NULL DEFAULT 'glb',
    "compression"   TEXT   NOT NULL DEFAULT 'draco',
    "byteSize"      INTEGER NOT NULL,
    "vertexCount"   INTEGER NOT NULL,
    "triangleCount" INTEGER NOT NULL,
    "sourceDataset" TEXT   NOT NULL DEFAULT 'BodyParts3D 3.0',
    "sourceFile"    TEXT   NOT NULL,
    "sourceSha256"  TEXT   NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mesh_assets_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "mesh_assets" ADD CONSTRAINT "mesh_assets_organId_key" UNIQUE ("organId");
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "mesh_assets_groupKey_idx" ON "mesh_assets"("groupKey");

DO $$ BEGIN
  ALTER TABLE "organs" ADD CONSTRAINT "organs_systemId_fkey"
    FOREIGN KEY ("systemId") REFERENCES "anatomical_systems"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "organs" ADD CONSTRAINT "organs_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "organs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mesh_assets" ADD CONSTRAINT "mesh_assets_organId_fkey"
    FOREIGN KEY ("organId") REFERENCES "organs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$;
