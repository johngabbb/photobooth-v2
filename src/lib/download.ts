import { renderToBlob } from "./render";
import { renderStoryToBlob } from "./story";
import type { StoryInput } from "./story";
import type { RenderInput } from "./types";

/** Render a card at export resolution and save it. */
export async function downloadCard(input: RenderInput, filename: string) {
  await save(await renderToBlob(input, "image/png"), filename);
}

/** Render the same card matted into a 1080x1920 story frame and save it. */
export async function downloadStory(input: StoryInput, filename: string) {
  await save(await renderStoryToBlob(input, "image/png"), filename);
}

async function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  // Revoking synchronously can cancel the download in some browsers; one turn of
  // the event loop is enough for the click to be consumed.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Stable, sortable filename for a saved card. `variant` distinguishes exports of the
 * same card, so saving both the print PNG and the story copy cannot collide.
 */
export function cardFilename(layoutId: string, variant?: string): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const kind = variant ? `${layoutId}-${variant}` : layoutId;
  return `pamkin-photo-bee-${kind}-${stamp}.png`;
}
