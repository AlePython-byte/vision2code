import { BadRequestException } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

export class ZodValidationPipe<Output> implements PipeTransform<unknown, Promise<Output>> {
  constructor(private readonly schema: ZodType<Output>) {}

  async transform(value: unknown): Promise<Output> {
    const result = await this.schema.safeParseAsync(value);
    if (!result.success) throw new BadRequestException();
    return result.data;
  }
}
