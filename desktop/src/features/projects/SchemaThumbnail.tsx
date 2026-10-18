import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FidelityMode } from "@vision2code/contracts";
import { useLabels } from "../preferences/useLabels";
import { PLACEHOLDER_THUMBNAIL, THUMB_HEIGHT, THUMB_WIDTH, type SchemaThumbnailModel, type ThumbBlock } from "./thumbnailBlocks.ts";
import type { ThumbnailModel } from "./thumbnailModel.ts";

export type ThumbnailSize = "sm" | "md";
export type ThumbnailViewState = "ready" | "loading" | "empty" | "unavailable";

function Block({ block }: { block: ThumbBlock }) {
  const className = `thumb-block thumb-${block.kind} thumb-tone-${block.tone}${block.dark ? " thumb-on-dark" : ""}`;
  if (block.kind === "icon") return <circle className={className} cx={block.x + block.w / 2} cy={block.y + block.h / 2} r={block.w / 2} />;
  if (block.kind === "image") {
    const at = (fx: number, fy: number) => `${(block.x + block.w * fx).toFixed(2)},${(block.y + block.h * fy).toFixed(2)}`;
    return <g>
      <rect className={className} x={block.x} y={block.y} width={block.w} height={block.h} rx={block.r} />
      {block.w >= 10 && block.h >= 8 && <polyline className="thumb-image-mark" points={[at(0.18, 0.78), at(0.42, 0.42), at(0.58, 0.64), at(0.7, 0.52), at(0.86, 0.78)].join(" ")} />}
    </g>;
  }
  return <rect className={className} x={block.x} y={block.y} width={block.w} height={block.h} rx={block.r} />;
}

/**
 * Decorative thumbnail of a UISchema: an inline SVG in a fixed 8:5 frame, painted only with design tokens (see the
 * `schema-thumb` rules in vault.css), so it follows the light and dark themes. Loading, empty and unavailable states
 * draw the same invented placeholder page, so the card never changes size.
 */
export function SchemaThumbnail({ model, size = "md", state = "ready", caption }: {
  model?: SchemaThumbnailModel | null | undefined;
  size?: ThumbnailSize;
  state?: ThumbnailViewState;
  /** Visible text for the empty and unavailable states (already translated). */
  caption?: string | undefined;
}) {
  const real = state === "ready" && model && !model.empty ? model : null;
  const shown = real ?? PLACEHOLDER_THUMBNAIL;
  const viewState = real ? "ready" : state === "ready" ? "empty" : state;
  return (
    <div className={`schema-thumb-frame schema-thumb-${size}`} data-state={viewState} aria-hidden="true">
      <svg className="schema-thumb" viewBox={`0 0 ${THUMB_WIDTH} ${THUMB_HEIGHT}`} focusable="false">
        <rect className="thumb-backdrop" width={THUMB_WIDTH} height={THUMB_HEIGHT} />
        {shown.blocks.map((block, index) => <Block key={index} block={block} />)}
      </svg>
      {!real && viewState !== "loading" && caption && <span className="schema-thumb-caption">{caption}</span>}
    </div>
  );
}

const noSubscribe = () => () => {};

/** One generation's entry in the thumbnail model (null until it was requested). */
export function useThumbnailEntry(model: ThumbnailModel | undefined, generationId: string | null | undefined) {
  const read = () => (model && generationId ? model.getSnapshot().entries[generationId] ?? null : null);
  return useSyncExternalStore(model?.subscribe ?? noSubscribe, read, read);
}

/** True once the element is near the viewport (or at once where IntersectionObserver does not exist). */
function useNearViewport() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near) return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/**
 * The thumbnail of a generation, fetched lazily: nothing is requested until the slot is near the viewport, so a
 * long list of projects does not download every generation at once. Without a generation (a draft project) or
 * without a model it shows the placeholder.
 */
export function ThumbnailSlot({ thumbnails, projectId, generationId, size = "md", emptyCaption, unavailableCaption }: {
  thumbnails?: ThumbnailModel | undefined;
  projectId: string;
  generationId: string | null | undefined;
  size?: ThumbnailSize;
  emptyCaption: string;
  unavailableCaption: string;
}) {
  const [ref, near] = useNearViewport();
  const entry = useThumbnailEntry(thumbnails, generationId);
  useEffect(() => {
    if (near && thumbnails && generationId) thumbnails.request(projectId, generationId);
  }, [near, thumbnails, projectId, generationId]);
  const state: ThumbnailViewState = !generationId || !thumbnails ? "empty"
    : entry?.status === "READY" ? (entry.thumbnail && !entry.thumbnail.empty ? "ready" : "unavailable")
      : entry?.status === "ERROR" ? "unavailable" : "loading";
  return (
    <div ref={ref} className="schema-thumb-slot">
      <SchemaThumbnail model={entry?.thumbnail ?? null} size={size} state={state}
        caption={state === "unavailable" ? unavailableCaption : emptyCaption} />
    </div>
  );
}

const fidelityKeys = { FAST: "fidelityFast", BALANCED: "fidelityBalanced", PRECISE: "fidelityPrecise" } as const;

/** Fidelity mode of a generation as a small mono chip; the full phrase ("Fidelity: Fast") is read by screen readers. */
export function FidelityChip({ mode }: { mode: FidelityMode }) {
  const { t } = useLabels();
  const label = t(fidelityKeys[mode]);
  return (
    <span className="fidelity-chip" data-mode={mode.toLowerCase()} title={t("historyFidelity", { value: label })}>
      <span className="sr-only">{t("historyFidelity", { value: label })}</span>
      <span aria-hidden="true">{label}</span>
    </span>
  );
}

/** A project's chip comes from its latest generation's detail (the project summary has no fidelity mode). */
export function ProjectFidelityChip({ thumbnails, generationId }: { thumbnails?: ThumbnailModel | undefined; generationId: string | null | undefined }) {
  const entry = useThumbnailEntry(thumbnails, generationId);
  return entry?.fidelityMode ? <FidelityChip mode={entry.fidelityMode} /> : null;
}
