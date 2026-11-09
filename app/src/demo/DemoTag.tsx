import { Tag } from "@/ui/Tag";

/** A small "Demo" label next to the demo host, so nobody takes it for a real computer. */
export function DemoTag() {
  return <Tag label="Demo" accessibilityLabel="Demo host" />;
}
