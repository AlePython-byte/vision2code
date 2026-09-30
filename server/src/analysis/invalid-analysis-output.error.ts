export class InvalidAnalysisOutputError extends Error {
  constructor() {
    super("Provider output does not satisfy UISchema v1.");
    this.name = "InvalidAnalysisOutputError";
  }
}
