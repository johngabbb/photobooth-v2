import { renderToBlob } from "./render";
import type { RenderInput } from "./types";

/** Render a card at export resolution and save it. */
export async function downloadCard(input: RenderInput, filename: string) {
  const blob = await renderToBlob(input, "image/png");
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // Revoking synchronously can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to be consumed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Stable, sortable filename for a saved card. */
export function cardFilename(layoutId: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `pamkin-photo-bee-${layoutId}-${stamp}.png`;
}
