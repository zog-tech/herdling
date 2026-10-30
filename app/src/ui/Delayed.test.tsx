import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useDelayed } from "./Delayed";

let seen: boolean[] = [];
function Probe({ on }: { on: boolean }) {
  seen.push(useDelayed(on));
  return null;
}

test("spinner_waits_300ms_and_hides_at_once", () => {
  jest.useFakeTimers();
  seen = [];
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<Probe on />);
  });
  act(() => jest.advanceTimersByTime(299));
  expect(seen[seen.length - 1]).toBe(false);
  act(() => jest.advanceTimersByTime(1));
  expect(seen[seen.length - 1]).toBe(true);
  act(() => t.update(<Probe on={false} />));
  expect(seen[seen.length - 1]).toBe(false);
  // A wait that ends early never shows the spinner.
  seen = [];
  act(() => t.update(<Probe on />));
  act(() => jest.advanceTimersByTime(100));
  act(() => t.update(<Probe on={false} />));
  act(() => jest.advanceTimersByTime(500));
  expect(seen.every((v) => v === false)).toBe(true);
  act(() => t.unmount());
  jest.useRealTimers();
});
