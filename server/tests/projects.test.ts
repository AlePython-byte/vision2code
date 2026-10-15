import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it, before, after, beforeEach } from "node:test";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../src/app.module.js";
import { SUPABASE_JWT_VERIFIER } from "../src/auth/supabase-auth.guard.js";
import { JoseSupabaseJwtVerifier } from "../src/auth/supabase-jwt-verifier.js";
import { configureApplication } from "../src/configure-application.js";
import { AI_PROVIDER } from "../src/analysis/analysis.constants.js";
import { PROJECT_REPOSITORY } from "../src/projects/project.repository.js";
import { InMemoryProjectRepository } from "../src/projects/in-memory-project.repository.js";
import { readFileSync, readdirSync } from "node:fs";
import {
  ApiErrorResponseSchema,
  ProjectSummarySchema,
  type UISchema,
  type GeneratedProject,
} from "@vision2code/contracts";

const validUiSchema: UISchema = {
  schemaVersion: "1.0",
  source: { width: 1440, height: 900 },
  confidence: 0.95,
  designTokens: {
    colors: [{ name: "primary", value: "#3b82f6" }],
    typography: [
      {
        name: "body",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.5,
        letterSpacing: null,
      },
    ],
    spacing: [0, 4, 8, 16],
    radii: [0, 4, 8],
  },
  root: {
    id: "root-1",
    type: "FRAME",
    name: "Main Container",
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
    layout: {
      mode: "FLEX",
      direction: "COLUMN",
      justify: "START",
      align: "STRETCH",
      gap: 16,
      columns: null,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    },
    style: {
      background: "#ffffff",
      color: "#000000",
      border: null,
      radius: 0,
      shadow: null,
      opacity: 1,
    },
    text: null,
    image: null,
    children: [],
  },
  warnings: [],
};

const validGeneratedProject: GeneratedProject = {
  target: "react-tailwind",
  generatorVersion: "1",
  files: [
    {
      path: "src/App.tsx",
      content: "export default function App() { return <div>Test</div>; }",
      language: "typescript",
    },
  ],
};

describe("Projects Domain & Persistence Architecture", () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let inMemoryRepo: InMemoryProjectRepository;
  let privateKey: any;

  const issuer = "https://example-project.supabase.co/auth/v1";
  const audience = "authenticated";

  const userA = { id: "11111111-1111-4111-8111-111111111111", email: "userA@example.com" };
  const userB = { id: "22222222-2222-4222-8222-222222222222", email: "userB@example.com" };

  async function createToken(sub: string, email: string) {
    return new SignJWT({ email, role: "authenticated" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-id-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);
  }

  let tokenUserA: string;
  let tokenUserB: string;

  before(async () => {
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    const publicKeyJwk: any = await exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = "test-key-id-1";
    publicKeyJwk.alg = "RS256";

    const keySetOverride = async (header: any) => {
      if (header.kid && header.kid !== publicKeyJwk.kid) {
        throw new Error("Unknown key ID");
      }
      return keyPair.publicKey;
    };

    const testVerifier = new JoseSupabaseJwtVerifier({
      expectedIssuer: issuer,
      expectedAudience: audience,
      keySetOverride,
    });

    tokenUserA = await createToken(userA.id, userA.email);
    tokenUserB = await createToken(userB.id, userB.email);

    inMemoryRepo = new InMemoryProjectRepository();

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDER).useValue({ analyze() { throw new Error("Unexpected analysis call."); } })
      .overrideProvider(SUPABASE_JWT_VERIFIER).useValue(testVerifier)
      .overrideProvider(PROJECT_REPOSITORY).useValue(inMemoryRepo)
      .compile();

    app = module.createNestApplication<NestExpressApplication>();
    app.useLogger(false);
    configureApplication(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  after(async () => {
    await app?.close();
  });

  beforeEach(() => {
    inMemoryRepo.clear();
  });

  async function api(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {}
  ): Promise<{ status: number; data: any; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const init: RequestInit = {
      method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
      headers,
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(`${baseUrl}${path}`, init);

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const data: any = isJson ? await response.json() : null;
    return { status: response.status, data, headers: response.headers };
  }

  // PART 15: SECURITY TESTS
  describe("Security Tests", () => {
    it("1. Project owner is taken from authenticated user, never request body", async () => {
      const res = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "Dashboard" },
      });
      assert.equal(res.status, 201);
      assert.ok(res.data.id);

      const saved = await inMemoryRepo.findProjectById(res.data.id);
      assert.equal(saved?.userId, userA.id, "Owner must match authenticated subject");
    });

    it("2. userId/ownerId in incoming payload is strictly rejected", async () => {
      const spoof1 = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "Dashboard", userId: userB.id },
      });
      assert.equal(spoof1.status, 400);

      const spoof2 = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "Dashboard", ownerId: userB.id },
      });
      assert.equal(spoof2.status, 400);
    });

    it("3. User A can read own project", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "My Project" },
      });
      const projectId = createRes.data.id;

      const getRes = await api(`/api/v1/projects/${projectId}`, {
        token: tokenUserA,
      });
      assert.equal(getRes.status, 200);
      assert.equal(getRes.data.id, projectId);
      assert.equal(getRes.data.name, "My Project");
    });

    it("4. User A cannot read User B project", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserB,
        body: { name: "User B Secret Project" },
      });
      const bProjectId = createRes.data.id;

      const attempt = await api(`/api/v1/projects/${bProjectId}`, {
        token: tokenUserA,
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");
    });

    it("5. User A cannot rename User B project", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserB,
        body: { name: "Original B Name" },
      });
      const bProjectId = createRes.data.id;

      const attempt = await api(`/api/v1/projects/${bProjectId}`, {
        method: "PATCH",
        token: tokenUserA,
        body: { name: "Hacked Name" },
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");

      const saved = await inMemoryRepo.findProjectById(bProjectId);
      assert.equal(saved?.name, "Original B Name");
    });

    it("6. User A cannot delete User B project", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserB,
        body: { name: "Project to Keep" },
      });
      const bProjectId = createRes.data.id;

      const attempt = await api(`/api/v1/projects/${bProjectId}`, {
        method: "DELETE",
        token: tokenUserA,
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");

      const saved = await inMemoryRepo.findProjectById(bProjectId);
      assert.ok(saved !== null);
    });

    it("7. User A cannot create generation under User B project", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserB,
        body: { name: "Target Project" },
      });
      const bProjectId = createRes.data.id;

      const attempt = await api(`/api/v1/projects/${bProjectId}/generations`, {
        token: tokenUserA,
        body: {
          uiSchema: validUiSchema,
          generatedProject: validGeneratedProject,
        },
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");
    });

    it("8. User A cannot read generation belonging to User B project", async () => {
      const project = await inMemoryRepo.createProject(userB.id, "B Project");
      const gen = await inMemoryRepo.createGeneration(project.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });

      const attempt = await api(`/api/v1/projects/${project.id}/generations/${gen.id}`, {
        token: tokenUserA,
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");
    });

    it("9. User A cannot delete generation belonging to User B project", async () => {
      const project = await inMemoryRepo.createProject(userB.id, "B Project");
      const gen = await inMemoryRepo.createGeneration(project.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });

      const attempt = await api(`/api/v1/projects/${project.id}/generations/${gen.id}`, {
        method: "DELETE",
        token: tokenUserA,
      });
      assert.equal(attempt.status, 404, "Must return 404 Not Found to prevent cross-user resource enumeration");

      const savedGen = await inMemoryRepo.findGenerationById(gen.id);
      assert.ok(savedGen !== null);
    });

    it("10. Generation ownership is enforced transitively through project ownership", async () => {
      const p1 = await inMemoryRepo.createProject(userA.id, "A Project 1");
      const p2 = await inMemoryRepo.createProject(userA.id, "A Project 2");
      const genP1 = await inMemoryRepo.createGeneration(p1.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });

      // Querying generation of p1 using p2's ID should 404
      const mismatch = await api(`/api/v1/projects/${p2.id}/generations/${genP1.id}`, {
        token: tokenUserA,
      });
      assert.equal(mismatch.status, 404);
    });

    it("11. Generation records are immutable (no PATCH /generations endpoint)", async () => {
      const project = await inMemoryRepo.createProject(userA.id, "A Project");
      const gen = await inMemoryRepo.createGeneration(project.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });

      const patchAttempt = await api(`/api/v1/projects/${project.id}/generations/${gen.id}`, {
        method: "PATCH",
        token: tokenUserA,
        body: { name: "Mutated" },
      });
      assert.equal(patchAttempt.status, 404, "PATCH on generation must not exist");
    });

    it("12. Invalid UISchema is rejected before persistence", async () => {
      const project = await inMemoryRepo.createProject(userA.id, "Valid Project");
      const res = await api(`/api/v1/projects/${project.id}/generations`, {
        token: tokenUserA,
        body: {
          uiSchema: { invalid: true },
          generatedProject: validGeneratedProject,
        },
      });
      assert.equal(res.status, 400);
    });

    it("13. Invalid GeneratedProject is rejected before persistence", async () => {
      const project = await inMemoryRepo.createProject(userA.id, "Valid Project");
      const res = await api(`/api/v1/projects/${project.id}/generations`, {
        token: tokenUserA,
        body: {
          uiSchema: validUiSchema,
          generatedProject: { target: "vue", files: [] },
        },
      });
      assert.equal(res.status, 400);
    });

    it("14. Whitespace-only project name rejected", async () => {
      const res = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "     " },
      });
      assert.equal(res.status, 400);
    });

    it("15. Overly long project name rejected", async () => {
      const res = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "X".repeat(101) },
      });
      assert.equal(res.status, 400);
    });

    it("16. Project listing is scoped by authenticated user", async () => {
      await inMemoryRepo.createProject(userA.id, "Project A1");
      await inMemoryRepo.createProject(userA.id, "Project A2");
      await inMemoryRepo.createProject(userB.id, "Project B1");

      const resA = await api("/api/v1/projects", { token: tokenUserA });
      assert.equal(resA.status, 200);
      assert.equal(resA.data.length, 2);
      assert.ok(resA.data.every((p: any) => p.name.startsWith("Project A")));

      const resB = await api("/api/v1/projects", { token: tokenUserB });
      assert.equal(resB.status, 200);
      assert.equal(resB.data.length, 1);
      assert.equal(resB.data[0].name, "Project B1");
    });

    it("17. Project ordering semantics deterministic (updatedAt desc)", async () => {
      const p1 = await inMemoryRepo.createProject(userA.id, "First Project");
      await new Promise((r) => setTimeout(r, 20));
      const p2 = await inMemoryRepo.createProject(userA.id, "Second Project");

      const list1 = await api("/api/v1/projects", { token: tokenUserA });
      assert.equal(list1.data[0].id, p2.id);
      assert.equal(list1.data[1].id, p1.id);

      // Updating p1 moves it to the top
      await new Promise((r) => setTimeout(r, 20));
      await api(`/api/v1/projects/${p1.id}`, {
        method: "PATCH",
        token: tokenUserA,
        body: { name: "First Project Updated" },
      });

      const list2 = await api("/api/v1/projects", { token: tokenUserA });
      assert.equal(list2.data[0].id, p1.id);
      assert.equal(list2.data[1].id, p2.id);
    });

    it("18. Generation ordering semantics deterministic (createdAt desc)", async () => {
      const p = await inMemoryRepo.createProject(userA.id, "Project for Generations");
      const g1 = await inMemoryRepo.createGeneration(p.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });
      await new Promise((r) => setTimeout(r, 20));
      const g2 = await inMemoryRepo.createGeneration(p.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "PRECISE",
      });

      const list = await api(`/api/v1/projects/${p.id}/generations`, { token: tokenUserA });
      assert.equal(list.status, 200);
      assert.equal(list.data[0].id, g2.id);
      assert.equal(list.data[1].id, g1.id);
    });
  });

  // PART 16: DOMAIN TESTS
  describe("Domain Tests", () => {
    it("create project returns valid summary with zero generations", async () => {
      const res = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "Client Landing" },
      });
      assert.equal(res.status, 201);
      assert.equal(res.data.name, "Client Landing");
      assert.equal(res.data.generationCount, 0);
      assert.equal(res.data.latestGenerationId, null);
    });

    it("rename project updates project name and preserves id", async () => {
      const createRes = await api("/api/v1/projects", {
        token: tokenUserA,
        body: { name: "Old Name" },
      });
      const id = createRes.data.id;

      const renameRes = await api(`/api/v1/projects/${id}`, {
        method: "PATCH",
        token: tokenUserA,
        body: { name: "New Name" },
      });
      assert.equal(renameRes.status, 200);
      assert.equal(renameRes.data.id, id);
      assert.equal(renameRes.data.name, "New Name");
    });

    it("create generation links to project and round-trips UISchema and GeneratedProject", async () => {
      const proj = await inMemoryRepo.createProject(userA.id, "Test Project");

      const createGen = await api(`/api/v1/projects/${proj.id}/generations`, {
        token: tokenUserA,
        body: {
          sourceImagePath: "users/u1/projects/p1/generations/g1/source.png",
          sourceImageName: "mockup.png",
          sourceImageMimeType: "image/png",
          uiSchema: validUiSchema,
          generatedProject: validGeneratedProject,
          generationTarget: "react-tailwind",
          fidelityMode: "precise",
        },
      });
      assert.equal(createGen.status, 201);
      assert.equal(createGen.data.projectId, proj.id);
      assert.equal(createGen.data.sourceImageName, "mockup.png");
      assert.equal(createGen.data.generationTarget, "REACT_TAILWIND");
      assert.equal(createGen.data.fidelityMode, "PRECISE");

      // Verify detail restoration
      const getGen = await api(`/api/v1/projects/${proj.id}/generations/${createGen.data.id}`, {
        token: tokenUserA,
      });
      assert.equal(getGen.status, 200);
      assert.deepEqual(getGen.data.uiSchema, validUiSchema);
      assert.deepEqual(getGen.data.generatedProject, validGeneratedProject);
    });

    it("generation detail restoration preserves full file tree for Monaco and Preview", async () => {
      const proj = await inMemoryRepo.createProject(userA.id, "Tree Test");
      const complexProject: GeneratedProject = {
        target: "react-tailwind",
        generatorVersion: "1",
        files: [
          { path: "src/App.tsx", content: "export default function App() {}", language: "typescript" },
          { path: "src/generated/GeneratedInterface.tsx", content: "export default function UI() {}", language: "typescript" },
          { path: "src/components/Header.tsx", content: "export function Header() {}", language: "typescript" },
        ],
      };

      const createGen = await api(`/api/v1/projects/${proj.id}/generations`, {
        token: tokenUserA,
        body: {
          uiSchema: validUiSchema,
          generatedProject: complexProject,
        },
      });

      const getGen = await api(`/api/v1/projects/${proj.id}/generations/${createGen.data.id}`, {
        token: tokenUserA,
      });
      assert.equal(getGen.data.generatedProject.files.length, 3);
      assert.equal(getGen.data.generatedProject.files[2].path, "src/components/Header.tsx");
    });

    it("deletion cascade removes project and all associated generations", async () => {
      const proj = await inMemoryRepo.createProject(userA.id, "Cascade Test");
      const gen1 = await inMemoryRepo.createGeneration(proj.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });
      const gen2 = await inMemoryRepo.createGeneration(proj.id, {
        sourceImagePath: null,
        sourceImageName: null,
        sourceImageMimeType: null,
        uiSchema: validUiSchema,
        generatedProject: validGeneratedProject,
        generationTarget: "REACT_TAILWIND",
        fidelityMode: "BALANCED",
      });

      const delRes = await api(`/api/v1/projects/${proj.id}`, {
        method: "DELETE",
        token: tokenUserA,
      });
      assert.equal(delRes.status, 204);

      assert.equal(await inMemoryRepo.findProjectById(proj.id), null);
      assert.equal(await inMemoryRepo.findGenerationById(gen1.id), null);
      assert.equal(await inMemoryRepo.findGenerationById(gen2.id), null);
    });

    it("supports null source image fields cleanly", async () => {
      const proj = await inMemoryRepo.createProject(userA.id, "Null Image Test");
      const createGen = await api(`/api/v1/projects/${proj.id}/generations`, {
        token: tokenUserA,
        body: {
          sourceImagePath: null,
          sourceImageName: null,
          sourceImageMimeType: null,
          uiSchema: validUiSchema,
          generatedProject: validGeneratedProject,
        },
      });
      assert.equal(createGen.status, 201);
      assert.equal(createGen.data.sourceImagePath, null);
      assert.equal(createGen.data.sourceImageName, null);
      assert.equal(createGen.data.sourceImageMimeType, null);
    });
  });

  // TASK 009G: rename and delete contracts relied on by the desktop's pessimistic flows.
  describe("Project rename and delete", () => {
    const missingId = "99999999-9999-4999-8999-999999999999";
    const generationBody = { sourceImagePath: null, sourceImageName: null, sourceImageMimeType: null, uiSchema: validUiSchema, generatedProject: validGeneratedProject };

    async function expectEnvelope(res: { status: number; data: any; headers: Headers }, status: number, code: string) {
      assert.equal(res.status, status);
      const body = ApiErrorResponseSchema.parse(res.data);
      assert.equal(body.error.code, code);
      assert.equal(body.error.requestId, res.headers.get("x-request-id"), "stable envelope correlated with the response");
    }

    it("rename trims the name with the create validation and returns a valid summary", async () => {
      const created = await api("/api/v1/projects", { token: tokenUserA, body: { name: "Before" } });
      const renamed = await api(`/api/v1/projects/${created.data.id}`, { method: "PATCH", token: tokenUserA, body: { name: "   After   " } });
      assert.equal(renamed.status, 200);
      assert.equal(ProjectSummarySchema.parse(renamed.data).name, "After");
    });

    it("rename rejects empty, whitespace, overlong and extra-field bodies with INVALID_REQUEST and keeps the name", async () => {
      const created = await api("/api/v1/projects", { token: tokenUserA, body: { name: "Keep me" } });
      for (const body of [{ name: "" }, { name: "    " }, { name: "X".repeat(101) }, { name: "Ok", userId: userB.id }, {}]) {
        const res = await api(`/api/v1/projects/${created.data.id}`, { method: "PATCH", token: tokenUserA, body });
        await expectEnvelope(res, 400, "INVALID_REQUEST");
      }
      assert.equal((await inMemoryRepo.findProjectById(created.data.id))?.name, "Keep me");
      const exact = await api(`/api/v1/projects/${created.data.id}`, { method: "PATCH", token: tokenUserA, body: { name: "Y".repeat(100) } });
      assert.equal(exact.status, 200, "100 characters is the inclusive limit");
    });

    it("rename and delete of a nonexistent project answer 404 NOT_FOUND", async () => {
      await expectEnvelope(await api(`/api/v1/projects/${missingId}`, { method: "PATCH", token: tokenUserA, body: { name: "Ghost" } }), 404, "NOT_FOUND");
      await expectEnvelope(await api(`/api/v1/projects/${missingId}`, { method: "DELETE", token: tokenUserA }), 404, "NOT_FOUND");
    });

    it("cross-user rename and delete answer 404 (never 403) and leave the project and its generations intact", async () => {
      const created = await api("/api/v1/projects", { token: tokenUserB, body: { name: "B owns this" } });
      const generation = await api(`/api/v1/projects/${created.data.id}/generations`, { token: tokenUserB, body: generationBody });
      await expectEnvelope(await api(`/api/v1/projects/${created.data.id}`, { method: "PATCH", token: tokenUserA, body: { name: "Taken" } }), 404, "NOT_FOUND");
      await expectEnvelope(await api(`/api/v1/projects/${created.data.id}`, { method: "DELETE", token: tokenUserA }), 404, "NOT_FOUND");
      assert.equal((await inMemoryRepo.findProjectById(created.data.id))?.name, "B owns this");
      assert.ok(await inMemoryRepo.findGenerationById(generation.data.id));
    });

    it("rename and delete require a valid bearer token", async () => {
      const created = await api("/api/v1/projects", { token: tokenUserA, body: { name: "Guarded" } });
      for (const token of [undefined, "not-a-jwt"]) {
        await expectEnvelope(await api(`/api/v1/projects/${created.data.id}`, { method: "PATCH", ...(token ? { token } : {}), body: { name: "Nope" } }), 401, "UNAUTHORIZED");
        await expectEnvelope(await api(`/api/v1/projects/${created.data.id}`, { method: "DELETE", ...(token ? { token } : {}) }), 401, "UNAUTHORIZED");
      }
      assert.equal((await inMemoryRepo.findProjectById(created.data.id))?.name, "Guarded");
    });

    it("rename bumps updatedAt, so the project moves to the top of the Recent order", async () => {
      const first = await api("/api/v1/projects", { token: tokenUserA, body: { name: "First" } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await api("/api/v1/projects", { token: tokenUserA, body: { name: "Second" } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const renamed = await api(`/api/v1/projects/${first.data.id}`, { method: "PATCH", token: tokenUserA, body: { name: "First renamed" } });
      assert.ok(Date.parse(renamed.data.updatedAt) > Date.parse(first.data.updatedAt));
      const list = await api("/api/v1/projects", { token: tokenUserA });
      assert.deepEqual(list.data.map((project: { id: string }) => project.id), [first.data.id, second.data.id]);
      assert.equal(Object.hasOwn(renamed.data, "generationCount"), false, "the rename response carries no counts");
    });

    it("deleting through HTTP cascades to generations created through HTTP; a second delete is 404", async () => {
      const created = await api("/api/v1/projects", { token: tokenUserA, body: { name: "Cascade over HTTP" } });
      const generations = [
        await api(`/api/v1/projects/${created.data.id}/generations`, { token: tokenUserA, body: generationBody }),
        await api(`/api/v1/projects/${created.data.id}/generations`, { token: tokenUserA, body: generationBody }),
      ];
      const removed = await api(`/api/v1/projects/${created.data.id}`, { method: "DELETE", token: tokenUserA });
      assert.equal(removed.status, 204);
      for (const generation of generations) {
        assert.equal(await inMemoryRepo.findGenerationById(generation.data.id), null);
        await expectEnvelope(await api(`/api/v1/projects/${created.data.id}/generations/${generation.data.id}`, { token: tokenUserA }), 404, "NOT_FOUND");
      }
      await expectEnvelope(await api(`/api/v1/projects/${created.data.id}/generations`, { token: tokenUserA }), 404, "NOT_FOUND");
      await expectEnvelope(await api(`/api/v1/projects/${created.data.id}`, { method: "DELETE", token: tokenUserA }), 404, "NOT_FOUND");
    });

    it("the Prisma schema and migration cascade generations on project delete (not assumed)", () => {
      const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
      assert.match(schema, /project\s+Project\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: Cascade\)/);
      const migrations = new URL("../../prisma/migrations/", import.meta.url);
      const sql = readdirSync(migrations, { withFileTypes: true }).filter((entry) => entry.isDirectory())
        .map((entry) => readFileSync(new URL(`${entry.name}/migration.sql`, migrations), "utf8")).join("\n");
      assert.match(sql, /FOREIGN KEY \("project_id"\) REFERENCES "projects"\("id"\) ON DELETE CASCADE/);
    });
  });
  // TASK 011B: generator v2 produces generatorVersion "2"; stored "1" generations stay valid.
  describe("Generator versions", () => {
    it("stores and returns both generator versions unchanged, and rejects unknown ones", async () => {
      const proj = await inMemoryRepo.createProject(userA.id, "Versions");
      const make = (generatorVersion: string) => ({ ...validGeneratedProject, generatorVersion });
      const created: Record<string, string> = {};
      for (const version of ["1", "2"]) {
        const res = await api(`/api/v1/projects/${proj.id}/generations`, {
          token: tokenUserA, body: { uiSchema: validUiSchema, generatedProject: make(version) },
        });
        assert.equal(res.status, 201, `version ${version}`);
        assert.equal(res.data.generatedProject.generatorVersion, version);
        created[version] = res.data.id;
      }
      for (const version of ["1", "2"]) {
        const res = await api(`/api/v1/projects/${proj.id}/generations/${created[version]}`, { token: tokenUserA });
        assert.equal(res.status, 200);
        assert.equal(res.data.generatedProject.generatorVersion, version, "restored exactly as stored");
      }
      for (const version of ["0", "3"]) {
        const res = await api(`/api/v1/projects/${proj.id}/generations`, {
          token: tokenUserA, body: { uiSchema: validUiSchema, generatedProject: make(version) },
        });
        assert.equal(res.status, 400, `version ${version}`);
      }
    });
  });
});
