-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generations" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source_image_path" VARCHAR(1024),
    "source_image_name" VARCHAR(255),
    "source_image_mime_type" VARCHAR(100),
    "ui_schema" JSONB NOT NULL,
    "generated_project" JSONB NOT NULL,
    "generation_target" VARCHAR(50) NOT NULL DEFAULT 'REACT_TAILWIND',
    "fidelity_mode" VARCHAR(50) NOT NULL DEFAULT 'BALANCED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_user_id_updated_at_idx" ON "projects"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "generations_project_id_created_at_idx" ON "generations"("project_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "generations" ADD CONSTRAINT "generations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

