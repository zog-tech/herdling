import { act, create } from "react-test-renderer";

const mockSpeakNow = jest.fn(async (..._a: unknown[]) => {});
const mockTap = jest.fn();
jest.mock("@/voice/useSpeakReplies", () => {
  const store = require("zustand").create()(() => ({ key: undefined }));
  return { useManualSpeech: store, speakReplyNow: (...a: unknown[]) => mockSpeakNow(...a) };
});
jest.mock("@/ui/haptics", () => ({ tap: () => mockTap() }));

import { useManualSpeech } from "@/voice/useSpeakReplies";
import { ReplyPlayButton } from "./ReplyPlayButton";

it("taps through the shared speak path and shows stop while it speaks", async () => {
  let r: any;
  await act(async () => {
    r = create(<ReplyPlayButton hostId="h" id="a1" markdown="Hi" />);
  });
  const btn = () => r.root.find((n: any) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function");
  expect(btn().props.accessibilityLabel).toBe("Read reply aloud");
  await act(async () => btn().props.onPress());
  expect(mockTap).toHaveBeenCalledTimes(1);
  expect(mockSpeakNow).toHaveBeenCalledWith("h", "Hi", "a1");
  await act(async () => useManualSpeech.setState({ key: "a1" }));
  expect(btn().props.accessibilityLabel).toBe("Stop reading reply");
  await act(async () => btn().props.onPress());
  expect(mockSpeakNow).toHaveBeenCalledTimes(2);
});
