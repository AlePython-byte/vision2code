import { avatarSpec, type AvatarEyes, type AvatarMouth } from "./avatarSpec.ts";

export type AvatarSize = "sm" | "md" | "lg";

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
    case "tall":
      return <>
        <ellipse className="avatar-eyes-fill" cx="25" cy="30" rx="2.4" ry="3.6" />
        <ellipse className="avatar-eyes-fill" cx="39" cy="30" rx="2.4" ry="3.6" />
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

/** Mouth shapes below the eyes (y 38 to 46), drawn with the palette's `eyes` colour. */
function Mouth({ variant }: { variant: AvatarMouth }) {
  switch (variant) {
    case "grin":
      return <path className="avatar-eyes-fill" d="M25 39.5 Q32 40.5 39 39.5 Q38 46.5 32 46.5 Q26 46.5 25 39.5 Z" />;
    case "flat":
      return <path className="avatar-eyes-line" d="M27 42 L37 42" fill="none" />;
    case "oh":
      return <ellipse className="avatar-eyes-line" cx="32" cy="42.5" rx="2.6" ry="3" fill="none" />;
    case "smirk":
      return <path className="avatar-eyes-line" d="M27 42.5 Q33 43 38 39.5" fill="none" />;
    case "smile":
    default:
      return <path className="avatar-eyes-line" d="M26 40 Q32 46 38 40" fill="none" />;
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
      aria-hidden="true" focusable="false" data-avatar-eyes={spec.eyes} data-avatar-mouth={spec.mouth}>
      <circle className="avatar-bg" cx="32" cy="32" r="32" />
      <path className="avatar-blob" d={spec.blobPath} />
      <Eyes variant={spec.eyes} />
      <Mouth variant={spec.mouth} />
    </svg>
  );
}
