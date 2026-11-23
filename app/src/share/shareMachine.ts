/**
 * The send of a share as a state machine: edit, upload the files, then deliver the prompt and open
 * the thread. Pure: `shareReducer(state, event)` gives the next state and the effects; the share
 * screen runs the effects. Each upload has a generation number, so the result of a canceled upload
 * does nothing.
 */

/** The agent that gets the share. */
export type ShareTarget = { hostId: string; paneId: string };

/**
 * `editing`: the user picks the agent and writes the note; `error` is the last failure.
 * `uploading`: the files go to the computer of `target`. `done`: the prompt is on its way and the
 * thread opens. `gen` is the generation of the last upload.
 */
export type ShareState =
  | { phase: "editing"; gen: number; error?: string }
  | { phase: "uploading"; gen: number; target: ShareTarget }
  | { phase: "done"; gen: number; target: ShareTarget };

export type ShareEvent =
  /** The Send tap. `uploads`: the share has files to upload first. */
  | { type: "send"; target: ShareTarget; uploads: boolean }
  | { type: "uploaded"; gen: number; paths: string[] }
  | { type: "uploadFailed"; gen: number; message: string }
  /** The Cancel tap during the upload. */
  | { type: "cancel" };

export type ShareEffect =
  | { type: "upload"; gen: number; target: ShareTarget }
  | { type: "abort" }
  /** Sends the prompt with these file paths and opens the thread of `target`. */
  | { type: "deliver"; target: ShareTarget; paths: string[] };

export const initialShareState: ShareState = { phase: "editing", gen: 0 };

export const CANCELED_MESSAGE = "Upload canceled, nothing sent.";

export function shareReducer(state: ShareState, event: ShareEvent): { state: ShareState; effects: ShareEffect[] } {
  const same = { state, effects: [] };
  switch (event.type) {
    case "send": {
      // One send at a time: a second tap during the upload or after it does nothing.
      if (state.phase !== "editing") return same;
      if (!event.uploads) {
        return { state: { phase: "done", gen: state.gen, target: event.target }, effects: [{ type: "deliver", target: event.target, paths: [] }] };
      }
      const gen = state.gen + 1;
      return { state: { phase: "uploading", gen, target: event.target }, effects: [{ type: "upload", gen, target: event.target }] };
    }
    case "uploaded":
      if (state.phase !== "uploading" || event.gen !== state.gen) return same;
      return {
        state: { phase: "done", gen: state.gen, target: state.target },
        effects: [{ type: "deliver", target: state.target, paths: event.paths }],
      };
    case "uploadFailed":
      if (state.phase !== "uploading" || event.gen !== state.gen) return same;
      return { state: { phase: "editing", gen: state.gen, error: event.message }, effects: [] };
    case "cancel":
      if (state.phase !== "uploading") return same;
      return { state: { phase: "editing", gen: state.gen, error: CANCELED_MESSAGE }, effects: [{ type: "abort" }] };
  }
}
