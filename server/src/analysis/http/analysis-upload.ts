import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { z } from "zod";
import { ApiHttpException } from "../../http/api-http.exception.js";
import { AnalysisImageMimeTypeSchema } from "../analysis-image-input.js";
import type { AnalysisImageInput } from "../analysis-image-input.js";
import { MAX_ANALYSIS_IMAGE_BYTES } from "../analysis.constants.js";

const DimensionSchema = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().positive());
const MetadataSchema = z.strictObject({ viewportWidth: DimensionSchema, viewportHeight: DimensionSchema });

// With no destination/storage option, Multer keeps the file in memory only.
const UploadInterceptor = FileInterceptor("image", {
  // Busboy emits limits at the boundary; allow the inclusive byte cap and three parts.
  limits: { fileSize: MAX_ANALYSIS_IMAGE_BYTES + 1, files: 1, fields: 2, parts: 4, fieldSize: 32 },
  fileFilter: (_request, file, callback) => {
    if (!AnalysisImageMimeTypeSchema.safeParse(file.mimetype).success) {
      callback(new ApiHttpException("UNSUPPORTED_IMAGE", 415), false);
    } else callback(null, true);
  },
});

@Injectable()
export class AnalysisUploadInterceptor extends UploadInterceptor {
  override async intercept(context: ExecutionContext, next: CallHandler) {
    if (!context.switchToHttp().getRequest<{ is: (type: string) => unknown }>().is("multipart/form-data")) {
      throw new BadRequestException();
    }
    try { return await super.intercept(context, next); }
    catch (error) {
      if (error instanceof PayloadTooLargeException) throw new ApiHttpException("IMAGE_TOO_LARGE", 413);
      throw error;
    }
  }
}

export function validateAnalysisUpload(file: Express.Multer.File | undefined, metadata: unknown): AnalysisImageInput {
  if (!file) throw new BadRequestException();
  if (file.size > MAX_ANALYSIS_IMAGE_BYTES) throw new ApiHttpException("IMAGE_TOO_LARGE", 413);
  const mime = AnalysisImageMimeTypeSchema.safeParse(file.mimetype);
  if (!mime.success || !file.buffer.length) throw new ApiHttpException("UNSUPPORTED_IMAGE", 415);
  const bytes = file.buffer;
  const signature = mime.data === "image/png"
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    : mime.data === "image/jpeg"
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!signature) throw new ApiHttpException("UNSUPPORTED_IMAGE", 415);
  const parsed = MetadataSchema.safeParse(metadata);
  if (!parsed.success) throw new BadRequestException();
  return { bytes: new Uint8Array(bytes), mimeType: mime.data, width: parsed.data.viewportWidth, height: parsed.data.viewportHeight };
}
