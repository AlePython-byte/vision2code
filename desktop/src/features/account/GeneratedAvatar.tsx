import { avatarSpec, type AvatarEyes } from "./avatarSpec.ts";

export type AvatarSize = "sm" | "md";

/** Eye shapes in the 64 x 64 view box, all drawn with the palette's single `eyes` colour. */
function Eyes({ variant }: { variant: AvatarEyes }) {
  switch (variant) {
    case "wide":
      return <>
        <circle className="avatar-eyes-line" cx="25" cy="30" r="4.4" fill="none" />
        <circle className="avatar-eyes-fill" cx="25" cy="30" r="1.9" />
        <circle className="avatar-eyes-line" cx="39" cy="30" r="4.4" fill="none" />
        <circle className="avatar-eyes-fill" cx="39" cy="30" r="1.9" />
      </>;
    case "sleepy":
      return <>
        <path className="avatar-eyes-line" d="M21 30.5 L29 31.8" fill="none" />
        <path className="avatar-eyes-line" d="M35 31.8 L43 30.5" fill="none" />
      </>;
    case "wink":
      return <>
        <circle className="avatar-eyes-fill" cx="25" cy="30" r="2.8" />
        <path className="avatar-eyes-line" d="M34 31 Q39 26.5 44 31" fill="none" />
      </>;
    case "happy":
      return <>
        <path className="avatar-eyes-line" d="M20.5 31 Q25 26 29.5 31" fill="none" />
        <path className="avatar-eyes-line" d="M34.5 31 Q39 26 43.5 31" fill="none" />
      </>;
    case "dots":
    default:
      return <>
        <circle className="avatar-eyes-fill" cx="25" cy="30" r="2.6" />
        <circle className="avatar-eyes-fill" cx="39" cy="30" r="2.6" />
      </>;
  }
}

/**
 * Inline SVG avatar, decorative (`aria-hidden`): the account name is always written next to it. `seed` is the
 * user id, never the e-mail address. Colours come from the `--avatar-<n>-*` tokens, so both themes are covered.
 */
export function GeneratedAvatar({ seed, size = "md" }: { seed: string; size?: AvatarSize }) {
  const spec = avatarSpec(seed);
  return (
    <svg className={`generated-avatar generated-avatar-${size} avatar-palette-${spec.palette + 1}`} viewBox="0 0 64 64"
      aria-hidden="true" focusable="false" data-avatar-eyes={spec.eyes}>
      <circle className="avatar-bg" cx="32" cy="32" r="32" />
      <path className="avatar-blob" d={spec.blobPath} />
      <Eyes variant={spec.eyes} />
    </svg>
  );
}
