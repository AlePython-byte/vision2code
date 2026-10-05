export interface GeneratedFile {
  path: string;
  content: string;
  language: "typescript";
}

export interface GeneratedProject {
  target: "react-tailwind";
  generatorVersion: "1";
  files: GeneratedFile[];
}
