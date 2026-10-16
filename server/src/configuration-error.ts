/**
 * A startup configuration problem whose message is safe to print: it names the variable and what it
 * must be, never the value it had. Bootstrap prints these messages and hides every other error.
 */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
