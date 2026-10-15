import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  CreateGenerationInputSchema,
  GeneratedFileSchema,
  GeneratedProjectSchema,
  GeneratedFileLanguageSchema,
  GENERATED_FILE_LANGUAGES,
  FidelityModeSchema,
  GenerationTargetSchema,
  ProjectSummarySchema,
  GenerationSummarySchema,
  GenerationDetailSchema,
  UISchemaSchema,
} from "../dist/index.js";

const simpleInterface = JSON.parse(
  readFileSync(new URL("./fixtures/simple-interface.json", import.meta.url), "utf8")
);

const validGeneratedProject = {
  target: "react-tailwind" as const,
  generatorVersion: "1",
  files: [
    {
      path: "src/App.tsx",
      content: "export default function App() { return <div>Test</div>; }",
      language: "typescript" as const,
    },
    {
      path: "src/generated/GeneratedInterface.tsx",
      content: "export default function GeneratedInterface() { return <div>Interface</div>; }",
      language: "typescript" as const,
    },
  ],
};

test("CreateProjectInputSchema accepts valid trimmed names", () => {
  const result = CreateProjectInputSchema.safeParse({ name: "  My Landing Page  " });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.name, "My Landing Page");
  }
});

test("CreateProjectInputSchema rejects empty and whitespace-only names", () => {
  assert.equal(CreateProjectInputSchema.safeParse({ name: "" }).success, false);
  assert.equal(CreateProjectInputSchema.safeParse({ name: "   " }).success, false);
  assert.equal(CreateProjectInputSchema.safeParse({ name: "\t\n " }).success, false);
});

test("CreateProjectInputSchema rejects overly long names (>100 characters)", () => {
  const longName = "A".repeat(101);
  assert.equal(CreateProjectInputSchema.safeParse({ name: longName }).success, false);
});

test("CreateProjectInputSchema strictly rejects userId and ownerId in payload", () => {
  const withUserId = CreateProjectInputSchema.safeParse({
    name: "Valid Name",
    userId: "123e4567-e89b-12d3-a456-426614174000",
  });
  assert.equal(withUserId.success, false);

  const withOwnerId = CreateProjectInputSchema.safeParse({
    name: "Valid Name",
    ownerId: "123e4567-e89b-12d3-a456-426614174000",
  });
  assert.equal(withOwnerId.success, false);
});

test("UpdateProjectInputSchema rejects empty and extra fields", () => {
  assert.equal(UpdateProjectInputSchema.safeParse({ name: "  " }).success, false);
  assert.equal(UpdateProjectInputSchema.safeParse({ name: "Renamed", userId: "spoofed" }).success, false);
  const valid = UpdateProjectInputSchema.safeParse({ name: "  Renamed  " });
  assert.equal(valid.success, true);
  if (valid.success) {
    assert.equal(valid.data.name, "Renamed");
  }
});

test("GeneratedProjectSchema validates valid project and rejects invalid structure", () => {
  const parsed = GeneratedProjectSchema.safeParse(validGeneratedProject);
  assert.equal(parsed.success, true);

  // Missing files
  assert.equal(GeneratedProjectSchema.safeParse({ ...validGeneratedProject, files: [] }).success, false);

  // Unsupported language
  assert.equal(
    GeneratedProjectSchema.safeParse({
      ...validGeneratedProject,
      files: [{ path: "test.py", content: "x", language: "python" }],
    }).success,
    false
  );

  // Unsupported target
  assert.equal(
    GeneratedProjectSchema.safeParse({
      ...validGeneratedProject,
      target: "vue",
    }).success,
    false
  );
});

test("FidelityModeSchema normalizes case", () => {
  assert.equal(FidelityModeSchema.parse("fast"), "FAST");
  assert.equal(FidelityModeSchema.parse("balanced"), "BALANCED");
  assert.equal(FidelityModeSchema.parse("precise"), "PRECISE");
  assert.equal(FidelityModeSchema.parse("BALANCED"), "BALANCED");
  assert.equal(FidelityModeSchema.safeParse("ultra").success, false);
});

test("GenerationTargetSchema normalizes case and format", () => {
  assert.equal(GenerationTargetSchema.parse("react-tailwind"), "REACT_TAILWIND");
  assert.equal(GenerationTargetSchema.parse("REACT_TAILWIND"), "REACT_TAILWIND");
  assert.equal(GenerationTargetSchema.safeParse("unknown").success, false);
});

test("CreateGenerationInputSchema validates full generation payload", () => {
  const input = {
    sourceImagePath: "users/u1/projects/p1/generations/g1/source.png",
    sourceImageName: "mockup.png",
    sourceImageMimeType: "image/png",
    uiSchema: simpleInterface,
    generatedProject: validGeneratedProject,
    generationTarget: "react-tailwind",
    fidelityMode: "precise",
  };

  const parsed = CreateGenerationInputSchema.safeParse(input);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.generationTarget, "REACT_TAILWIND");
    assert.equal(parsed.data.fidelityMode, "PRECISE");
    assert.equal(parsed.data.sourceImageName, "mockup.png");
  }
});

test("CreateGenerationInputSchema accepts null source image fields", () => {
  const input = {
    sourceImagePath: null,
    sourceImageName: null,
    sourceImageMimeType: null,
    uiSchema: simpleInterface,
    generatedProject: validGeneratedProject,
  };

  const parsed = CreateGenerationInputSchema.safeParse(input);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.generationTarget, "REACT_TAILWIND"); // default
    assert.equal(parsed.data.fidelityMode, "BALANCED"); // default
    assert.equal(parsed.data.sourceImagePath, null);
  }
});

test("CreateGenerationInputSchema rejects invalid UISchema and GeneratedProject", () => {
  const invalidUI = {
    uiSchema: { schemaVersion: "99.0", invalid: true },
    generatedProject: validGeneratedProject,
  };
  assert.equal(CreateGenerationInputSchema.safeParse(invalidUI).success, false);

  const invalidProject = {
    uiSchema: simpleInterface,
    generatedProject: { target: "react-tailwind", files: [] },
  };
  assert.equal(CreateGenerationInputSchema.safeParse(invalidProject).success, false);
});

test("GeneratedFileLanguageSchema validates every supported file language", () => {
  const expectedLanguages = ["typescript", "javascript", "css", "html", "json", "plaintext"];
  assert.deepEqual([...GENERATED_FILE_LANGUAGES], expectedLanguages);

  for (const lang of expectedLanguages) {
    const parsed = GeneratedFileLanguageSchema.safeParse(lang);
    assert.equal(parsed.success, true, `Language ${lang} should be valid`);
  }
});

test("GeneratedFileLanguageSchema rejects unsupported languages", () => {
  const invalidLanguages = ["python", "ruby", "csharp", "php", "", "unknown"];
  for (const lang of invalidLanguages) {
    const parsed = GeneratedFileLanguageSchema.safeParse(lang);
    assert.equal(parsed.success, false, `Language ${lang} should be rejected`);
  }
});

test("GeneratedFileSchema validates files for each supported language", () => {
  for (const language of GENERATED_FILE_LANGUAGES) {
    const fileResult = GeneratedFileSchema.safeParse({
      path: `src/assets/file.${language}`,
      content: `// content for ${language}`,
      language,
    });
    assert.equal(fileResult.success, true, `File with language ${language} should validate`);
  }
});

test("GeneratedFileSchema rejects files with empty paths or unsupported languages", () => {
  assert.equal(
    GeneratedFileSchema.safeParse({ path: "", content: "x", language: "typescript" }).success,
    false
  );
  assert.equal(
    GeneratedFileSchema.safeParse({ path: "   ", content: "x", language: "typescript" }).success,
    false
  );
  assert.equal(
    GeneratedFileSchema.safeParse({ path: "test.py", content: "x", language: "python" }).success,
    false
  );
});

test("GeneratedProjectSchema validates multi-file projects with diverse languages", () => {
  const multiLangProject = {
    target: "react-tailwind",
    generatorVersion: "1",
    files: [
      { path: "src/App.tsx", content: "export default function App() {}", language: "typescript" },
      { path: "src/styles.css", content: ".body { margin: 0; }", language: "css" },
      { path: "public/index.html", content: "<!DOCTYPE html><html></html>", language: "html" },
      { path: "config.json", content: '{"theme":"dark"}', language: "json" },
      { path: "legacy.js", content: "module.exports = {};", language: "javascript" },
      { path: "notes.txt", content: "Design notes", language: "plaintext" },
    ],
  };

  const parsed = GeneratedProjectSchema.safeParse(multiLangProject);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.files.length, 6);
  }
});

test("GeneratedProjectSchema rejects projects with invalid version or target", () => {
  assert.equal(
    GeneratedProjectSchema.safeParse({
      target: "vue-tailwind",
      generatorVersion: "1",
      files: [{ path: "App.vue", content: "", language: "html" }],
    }).success,
    false
  );

  assert.equal(
    GeneratedProjectSchema.safeParse({
      target: "react-tailwind",
      generatorVersion: "3", // Only "1" (stored) and "2" (current generator) are known versions
      files: [{ path: "App.tsx", content: "", language: "typescript" }],
    }).success,
    false
  );
});

