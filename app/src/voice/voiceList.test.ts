import { accentOf, deviceVoices, voiceLabel } from "./voiceList";

const v = (identifier: string, name: string, language: string, quality = "Default") => ({ identifier, name, language, quality });

describe("voiceList", () => {
  it("names the accent of a language tag", () => {
    expect(accentOf("en-GB")).toBe("UK");
    expect(accentOf("en_US")).toBe("US");
    expect(accentOf("en-SG")).toBe("SG");
    expect(accentOf("en")).toBeUndefined();
  });

  it("labels each voice with its accent, so the two Flo voices differ", () => {
    expect(voiceLabel({ name: "Flo", language: "en-US" })).toBe("Flo · US");
    expect(voiceLabel({ name: "Flo", language: "en-GB" })).toBe("Flo · UK");
    expect(voiceLabel({ name: "Flo", language: "en" })).toBe("Flo");
  });

  it("keeps the device language, puts its region first, then enhanced, then by name", () => {
    const all = [
      v("1", "Flo", "en-GB"),
      v("2", "Flo", "en-US"),
      v("3", "Thomas", "fr-FR"),
      v("4", "Ava", "en-US", "Enhanced"),
      v("5", "Daniel", "en-GB", "Enhanced"),
      v("6", "Bob", "en-US"),
    ];
    expect(deviceVoices(all, "en-US").map((x) => x.identifier)).toEqual(["4", "6", "2", "5", "1"]);
    expect(deviceVoices(all, "en").map((x) => x.identifier)).toEqual(["4", "5", "6", "1", "2"]);
  });
});
