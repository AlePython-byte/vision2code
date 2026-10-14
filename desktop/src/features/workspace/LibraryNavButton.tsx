import { useSyncExternalStore } from "react";
import { Library } from "lucide-react";
import { useLabels } from "../preferences/useLabels";
import type { LibraryModel } from "../projects/libraryModel";

/** Navigation rail entry that opens the library dialog (it does not change the current view). */
export function LibraryNavButton({ library }: { library: LibraryModel }) {
  const { t } = useLabels();
  const state = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  return (
    <button type="button" className="navigation-item" aria-haspopup="dialog" aria-expanded={state.open}
      aria-current={state.open ? "true" : undefined} aria-label={t("library")} title={t("library")}
      onClick={(event) => library.openDialog(null, event.currentTarget)}>
      <Library aria-hidden="true" /><small>{t("library")}</small>
    </button>
  );
}
