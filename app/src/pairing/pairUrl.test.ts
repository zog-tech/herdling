import { parsePairUrl } from "./pairUrl";

describe("parsePairUrl", () => {
  it("parse_pair_url", () => {
    expect(parsePairUrl("zogssh://pair?h=10.0.0.5&p=7790&c=123456")).toEqual({
      address: "10.0.0.5",
      port: 7790,
      code: "123456",
    });
  });

  it("parse_pair_url_missing_code", () => {
    expect(parsePairUrl("zogssh://pair?h=10.0.0.5&p=7790")).toBeNull();
  });

  it("parse_pair_url_short_code", () => {
    expect(parsePairUrl("zogssh://pair?h=10.0.0.5&p=7790&c=12345")).toBeNull();
  });

  it("parse_pair_url_other_scheme", () => {
    expect(parsePairUrl("https://pair?h=10.0.0.5&p=7790&c=123456")).toBeNull();
    expect(parsePairUrl("zogssh://other?h=10.0.0.5&p=7790&c=123456")).toBeNull();
  });

  it("parse_pair_url_bad_port_or_host", () => {
    expect(parsePairUrl("zogssh://pair?h=10.0.0.5&p=99999&c=123456")).toBeNull();
    expect(parsePairUrl("zogssh://pair?h=&p=7790&c=123456")).toBeNull();
    expect(parsePairUrl("not a url")).toBeNull();
  });

  it("parse_pair_url_default_port", () => {
    expect(parsePairUrl("zogssh://pair?h=10.0.0.5&c=123456")).toEqual({
      address: "10.0.0.5",
      port: 7790,
      code: "123456",
    });
  });
});
