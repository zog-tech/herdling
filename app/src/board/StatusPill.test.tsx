import { act, create } from "react-test-renderer";

import { usePillNow } from "./StatusPill";

function renderHook(fn: () => number) {
  const result = { current: 0 };
  function Probe() {
    result.current = fn();
    return null;
  }
  act(() => {
    create(<Probe />);
  });
  return { result };
}

describe("usePillNow", () => {
  beforeEach(() => jest.useFakeTimers({ now: 100_000 }));
  afterEach(() => jest.useRealTimers());

  it("ticks every second while the pill shows seconds", () => {
    const { result } = renderHook(() => usePillNow(90_000, 100_000));
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe(101_000);
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current).toBe(102_000);
  });

  it("follows the Board clock after the first minute", () => {
    const { result } = renderHook(() => usePillNow(0, 100_000));
    act(() => jest.advanceTimersByTime(3_000));
    expect(result.current).toBe(100_000);
  });

  it("stops when the Board clock stopped", () => {
    const { result } = renderHook(() => usePillNow(70_000, 80_000));
    act(() => jest.advanceTimersByTime(3_000));
    expect(result.current).toBe(80_000);
  });
});
