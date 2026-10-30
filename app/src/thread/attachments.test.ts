import * as ImagePicker from "expo-image-picker";

import { jpegName, photosAvailable, pickPhotos, withPaths } from "./attachments";

const mockOptional = jest.fn((_name: string): unknown => ({}));
jest.mock("expo", () => ({ requireOptionalNativeModule: (n: string) => mockOptional(n) }));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

test("with_paths_puts_each_path_on_its_own_line", () => {
  expect(withPaths("Fix this  \n", ["/a.jpg", "/b.jpg"])).toBe("Fix this\n/a.jpg\n/b.jpg");
  expect(withPaths("", ["/a.jpg"])).toBe("/a.jpg");
  expect(withPaths("text", [])).toBe("text");
});

test("jpeg_name_replaces_the_extension", () => {
  expect(jpegName("IMG_0001.HEIC", 0)).toBe("IMG_0001.jpg");
  expect(jpegName("shot", 0)).toBe("shot.jpg");
  expect(jpegName(null, 2)).toBe("photo-3.jpg");
  expect(jpegName(".HEIC", 0)).toBe("photo-1.jpg");
});

test("pick_photos_returns_nothing_on_cancel_and_skips_assets_without_data", async () => {
  const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
  launch.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await pickPhotos(4)).toEqual([]);

  launch.mockResolvedValueOnce({
    canceled: false,
    assets: [
      { uri: "file:///a", fileName: "a.png", base64: "AAA" },
      { uri: "file:///b", fileName: "b.png", base64: null },
    ],
  });
  expect(await pickPhotos(2)).toEqual([{ uri: "file:///a", name: "a.jpg", base64: "AAA" }]);
  expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 2 }));

  launch.mockClear();
  expect(await pickPhotos(0)).toEqual([]);
  expect(launch).not.toHaveBeenCalled();
});

test("a_binary_without_the_picker_has_no_photos_and_never_opens_it", async () => {
  mockOptional.mockReturnValueOnce(null).mockReturnValueOnce(null);
  expect(photosAvailable()).toBe(false);
  const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
  launch.mockClear();
  expect(await pickPhotos(4)).toEqual([]);
  expect(launch).not.toHaveBeenCalled();
});
