export function isVaultSearchShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k";
}

export function handleVaultDialogKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
  saving: boolean,
  focusable: readonly Pick<HTMLElement, "focus">[],
  active: unknown,
  close: () => void,
): void {
  if (event.key === "Escape") {
    if (!saving) { event.preventDefault(); close(); }
    return;
  }
  if (event.key !== "Tab" || focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}
