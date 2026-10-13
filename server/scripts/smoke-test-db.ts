import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || databaseUrl.includes("dummy:dummy")) {
    console.log("[DB SMOKE TEST] DATABASE_URL is not configured. Skipping real database test.");
    return;
  }

  console.log("[DB SMOKE TEST] Starting real Prisma repository smoke test against database...");
  const prisma = new PrismaClient();

  const testUserId = randomUUID();
  let createdProjectId: string | null = null;

  try {
    // 1. Create Project
    const initialProject = await prisma.project.create({
      data: {
        id: randomUUID(),
        userId: testUserId,
        name: "Smoke Test Project",
      },
    });
    createdProjectId = initialProject.id;
    console.log("[DB SMOKE TEST] 1. Created project:", createdProjectId);

    // 2. List projects by userId
    const userProjects = await prisma.project.findMany({
      where: { userId: testUserId },
      orderBy: { updatedAt: "desc" },
    });
    assert.equal(userProjects.length, 1);
    assert.equal(userProjects[0].id, createdProjectId);
    console.log("[DB SMOKE TEST] 2. Listed project by userId successfully");

    // 3. Create Generation with JSON UISchema and GeneratedProject
    const sampleUiSchema = {
      schemaVersion: "1.0",
      source: { width: 1280, height: 800 },
      confidence: 0.95,
      designTokens: { colors: ["#ffffff"], spacing: [0, 4, 8], radii: [0, 4] },
      root: {
        id: "root-1",
        type: "FRAME",
        name: "Root",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        layout: { mode: "FLEX", direction: "COLUMN", justify: "START", align: "START", gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, columns: null },
        style: { background: "#ffffff", color: "#000000", border: null, radius: null, shadow: null, opacity: 1 },
        text: null,
        image: null,
        children: [],
      },
      warnings: [],
    };

    const sampleGeneratedProject = {
      target: "react-tailwind",
      generatorVersion: "1",
      files: [
        { path: "src/App.tsx", content: "export default function App() {}", language: "typescript" },
        { path: "src/styles.css", content: ".test { color: red; }", language: "css" },
        { path: "metadata.json", content: '{"version": 1}', language: "json" },
      ],
    };

    // Sleep briefly so updatedAt timestamp bump is measurable
    await new Promise((r) => setTimeout(r, 50));

    const [generation1] = await prisma.$transaction([
      prisma.generation.create({
        data: {
          id: randomUUID(),
          projectId: createdProjectId,
          sourceImagePath: "tests/smoke-1.png",
          sourceImageName: "smoke-1.png",
          sourceImageMimeType: "image/png",
          uiSchema: sampleUiSchema,
          generatedProject: sampleGeneratedProject,
          generationTarget: "REACT_TAILWIND",
          fidelityMode: "BALANCED",
        },
      }),
      prisma.project.update({
        where: { id: createdProjectId },
        data: { updatedAt: new Date() },
      }),
    ]);
    console.log("[DB SMOKE TEST] 3. Created generation 1:", generation1.id);

    // 4. Validate JSON UISchema round-trip
    assert.deepEqual(generation1.uiSchema, sampleUiSchema);
    console.log("[DB SMOKE TEST] 4. UISchema round-trip verified");

    // 5. Validate JSON GeneratedProject round-trip (with multi-language files)
    assert.deepEqual(generation1.generatedProject, sampleGeneratedProject);
    console.log("[DB SMOKE TEST] 5. GeneratedProject round-trip verified");

    // 6. Validate project.updatedAt changed
    const updatedProject = await prisma.project.findUniqueOrThrow({
      where: { id: createdProjectId },
    });
    assert.ok(
      updatedProject.updatedAt.getTime() > initialProject.updatedAt.getTime(),
      "project.updatedAt must advance when a generation is added"
    );
    console.log("[DB SMOKE TEST] 6. Atomic project.updatedAt bump verified");

    // 7. Generation ordering
    await new Promise((r) => setTimeout(r, 50));
    const [generation2] = await prisma.$transaction([
      prisma.generation.create({
        data: {
          id: randomUUID(),
          projectId: createdProjectId,
          sourceImagePath: null,
          sourceImageName: null,
          sourceImageMimeType: null,
          uiSchema: sampleUiSchema,
          generatedProject: sampleGeneratedProject,
          generationTarget: "REACT_TAILWIND",
          fidelityMode: "PRECISE",
        },
      }),
      prisma.project.update({
        where: { id: createdProjectId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const generations = await prisma.generation.findMany({
      where: { projectId: createdProjectId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(generations.length, 2);
    assert.equal(generations[0].id, generation2.id);
    assert.equal(generations[1].id, generation1.id);
    console.log("[DB SMOKE TEST] 7. Generation ordering (createdAt desc) verified");

    // 8. Cascade deletion
    await prisma.project.delete({
      where: { id: createdProjectId },
    });
    createdProjectId = null;

    const remainingGenerations = await prisma.generation.findMany({
      where: { id: { in: [generation1.id, generation2.id] } },
    });
    assert.equal(remainingGenerations.length, 0, "Cascade deletion must remove all associated generations");
    console.log("[DB SMOKE TEST] 8. Cascade deletion verified");

    console.log("[DB SMOKE TEST] ALL 8 REAL PRISMA SMOKE CHECKS PASSED SUCCESSFULLY!");
  } finally {
    // Guaranteed cleanup if anything failed before cascade deletion
    if (createdProjectId) {
      try {
        await prisma.project.delete({ where: { id: createdProjectId } });
        console.log("[DB SMOKE TEST] Cleaned up test project:", createdProjectId);
      } catch {
        // ignore cleanup error
      }
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("[DB SMOKE TEST FAILED]", err);
  process.exit(1);
});

