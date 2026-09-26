// Task-specific input and output types belong to the module that consumes this boundary.
// No provider is registered or implemented at this stage.
export interface AIProvider<Input, Output> {
  analyze(input: Input, signal?: AbortSignal): Promise<Output>;
}
