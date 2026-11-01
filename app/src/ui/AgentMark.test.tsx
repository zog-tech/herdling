import Svg, { Path } from "react-native-svg";
import { act, create } from "react-test-renderer";

import { AgentMark, agentLetters, agentTint } from "./AgentMark";
import { AGENT_LOGOS } from "./agentLogos";

const render = (el: React.ReactElement) => {
  let t!: ReturnType<typeof create>;
  act(() => {
    t = create(el);
  });
  return t;
};
const texts = (t: ReturnType<typeof create>) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);

test("a_kind_with_a_logo_draws_an_svg_in_its_tint_and_no_letters", () => {
  const t = render(<AgentMark kind="claude" size={40} />);
  const svg = t.root.findByType(Svg);
  expect(svg.props.width).toBe(24);
  expect(svg.props.viewBox).toBe(AGENT_LOGOS.claude.viewBox);
  expect(t.root.findByType(Path).props.fill).toBe(agentTint("claude"));
  expect(texts(t)).not.toContain("Cl");
});

test("a_kind_without_a_logo_keeps_the_letter_badge", () => {
  const t = render(<AgentMark kind="amp" />);
  expect(t.root.findAllByType(Svg)).toHaveLength(0);
  expect(texts(t)).toContain("Am");
  expect(agentLetters("amp")).toBe("Am");
});

test("the_mark_is_hidden_from_voiceover", () => {
  const t = render(<AgentMark kind="codex" />);
  expect(t.root.findAll((n) => n.props.accessibilityElementsHidden === true).length).toBeGreaterThan(0);
});

test("every_logo_has_a_path_and_a_view_box", () => {
  for (const logo of Object.values(AGENT_LOGOS)) {
    expect(logo.path.length).toBeGreaterThan(10);
    expect(logo.viewBox).toBe("0 0 24 24");
  }
});
