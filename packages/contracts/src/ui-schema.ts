import { z } from "zod";

const NameSchema = z.string().trim().min(1);
// Hex colors keep visual values portable and exclude executable or arbitrary CSS.
const ColorSchema = z.string().regex(/^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/);
const NonNegativeSchema = z.number().nonnegative();
const TypographyFields = {
  fontFamily: z.string().nullable(),
  fontSize: z.number().positive().nullable(),
  fontWeight: z.number().min(1).max(1000).nullable(),
  lineHeight: z.number().positive().nullable(),
  letterSpacing: z.number().nullable(),
};

const DesignTokensSchema = z.strictObject({
  colors: z.array(z.strictObject({ name: NameSchema, value: ColorSchema })),
  typography: z.array(z.strictObject({ name: NameSchema, ...TypographyFields })),
  spacing: z.array(NonNegativeSchema),
  radii: z.array(NonNegativeSchema),
});

const BoundsSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: NonNegativeSchema,
  height: NonNegativeSchema,
});

const LayoutSchema = z.strictObject({
  mode: z.enum(["NONE", "FLEX", "GRID", "ABSOLUTE"]),
  direction: z.enum(["NONE", "ROW", "COLUMN"]),
  justify: z.enum(["START", "CENTER", "END", "SPACE_BETWEEN"]),
  align: z.enum(["START", "CENTER", "END", "STRETCH"]),
  gap: NonNegativeSchema.nullable(),
  columns: z.number().int().positive().nullable(),
  padding: z.strictObject({
    top: NonNegativeSchema,
    right: NonNegativeSchema,
    bottom: NonNegativeSchema,
    left: NonNegativeSchema,
  }),
});

const StyleSchema = z.strictObject({
  background: ColorSchema.nullable(),
  color: ColorSchema.nullable(),
  border: z.strictObject({ width: NonNegativeSchema, color: ColorSchema }).nullable(),
  radius: NonNegativeSchema.nullable(),
  shadow: z.strictObject({
    x: z.number(),
    y: z.number(),
    blur: NonNegativeSchema,
    spread: z.number(),
    color: ColorSchema,
  }).nullable(),
  opacity: z.number().min(0).max(1),
});

const TextSchema = z.strictObject({
  content: z.string(),
  ...TypographyFields,
  textAlign: z.enum(["START", "CENTER", "END", "JUSTIFY"]),
});

const ImageSchema = z.strictObject({
  description: z.string(),
  fit: z.enum(["CONTAIN", "COVER", "FILL", "NONE"]),
});

export const UINodeSchema = z.strictObject({
  id: NameSchema,
  type: z.enum(["FRAME", "TEXT", "IMAGE", "ICON", "BUTTON", "INPUT", "DIVIDER"]),
  name: NameSchema,
  bounds: BoundsSchema,
  layout: LayoutSchema,
  style: StyleSchema,
  text: TextSchema.nullable(),
  image: ImageSchema.nullable(),
  get children(): z.ZodArray<typeof UINodeSchema> {
    return z.array(UINodeSchema);
  },
});

export const UISchemaSchema = z.strictObject({
  schemaVersion: z.literal("1.0"),
  source: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  confidence: z.number().min(0).max(1),
  designTokens: DesignTokensSchema,
  root: UINodeSchema,
  warnings: z.array(z.string()),
});

export type UINode = z.infer<typeof UINodeSchema>;
export type UISchema = z.infer<typeof UISchemaSchema>;
