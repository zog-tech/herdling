import { Text, TextInput } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { SearchField } from "./SearchField";

test("search_field_types_submits_and_names_itself", () => {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<SearchField value="" onChangeText={onChange} placeholder="Agent, computer or folder" accessibilityLabel="Filter agents" onSubmitEditing={onSubmit} />);
  });
  const input = t.root.findByType(TextInput);
  expect(input.props.accessibilityLabel).toBe("Filter agents");
  expect(input.props.autoCorrect).toBe(false);
  expect(input.props.clearButtonMode).toBe("while-editing");
  act(() => input.props.onChangeText("api"));
  expect(onChange).toHaveBeenCalledWith("api");
  act(() => input.props.onSubmitEditing());
  expect(onSubmit).toHaveBeenCalledTimes(1);
  // A trailing part turns the clear button off; the label defaults to the placeholder.
  act(() => t.update(<SearchField value="x" onChangeText={onChange} placeholder="Search" trailing={<Text>3 of 12</Text>} />));
  expect(t.root.findByType(TextInput).props.clearButtonMode).toBe("never");
  expect(t.root.findByType(TextInput).props.accessibilityLabel).toBe("Search");
  act(() => t.unmount());
});
