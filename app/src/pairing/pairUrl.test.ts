import { parsePairUrl } from "./pairUrl";

describe("parsePairUrl", () => {
  it("parse_pair_url", () => {
    expect(parsePairUrl("herdling://pair?h=10.0.0.5&p=7790&c=123456")).toEqual({
      address: "10.0.0.5",
      port: 7790,
      code: "123456",
    });
  });

  it("parse_pair_url_missing_code", () => {
    expect(parsePairUrl("herdling://pair?h=10.0.0.5&p=7790")).toBeNull();
  });

  it("parse_pair_url_short_code", () => {
    expect(parsePairUrl("herdling://pair?h=10.0.0.5&p=7790&c=12345")).toBeNull();
  });

  it("parse_pair_url_other_scheme", () => {
    expect(parsePairUrl("https://pair?h=10.0.0.5&p=7790&c=123456")).toBeNull();
    expect(parsePairUrl("herdling://other?h=10.0.0.5&p=7790&c=123456")).toBeNull();
  });

  it("parse_pair_url_bad_port_or_host", () => {
    expect(parsePairUrl("herdling://pair?h=10.0.0.5&p=99999&c=123456")).toBeNull();
    expect(parsePairUrl("herdling://pair?h=&p=7790&c=123456")).toBeNull();
    expect(parsePairUrl("not a url")).toBeNull();
  });

  it("parse_pair_url_default_port", () => {
    expect(parsePairUrl("herdling://pair?h=10.0.0.5&c=123456")).toEqual({
      address: "10.0.0.5",
      port: 7790,
      code: "123456",
    });
  });
});

it("parse_pair_url_rejects_port_or_list_in_host", () => {
  expect(parsePairUrl("herdling://pair?h=10.0.0.5:80&c=123456")).toBeNull();
  expect(parsePairUrl("herdling://pair?h=10.0.0.5,10.0.0.6&c=123456")).toBeNull();
});

it("parse_pair_url_reads_fingerprint", () => {
  const fp = "SHA256:" + "a+b/".repeat(10) + "xyz";
  expect(parsePairUrl(`herdling://pair?h=10.0.0.5&p=7790&c=123456&f=${encodeURIComponent(fp)}`)).toEqual({
    address: "10.0.0.5",
    port: 7790,
    code: "123456",
    fingerprint: fp,
  });
  // The companion's own encoding.
  expect(parsePairUrl("herdling://pair?h=10.0.0.5&c=123456&f=SHA256%3A" + "A%2BB%2F".repeat(10) + "xyz")?.fingerprint).toBe(
    "SHA256:" + "A+B/".repeat(10) + "xyz",
  );
});

it("parse_pair_url_rejects_bad_fingerprint", () => {
  expect(parsePairUrl("herdling://pair?h=10.0.0.5&c=123456&f=")).toBeNull();
  expect(parsePairUrl("herdling://pair?h=10.0.0.5&c=123456&f=SHA256%3Ashort")).toBeNull();
  // An unencoded `+` reads as a space, so the value is not a fingerprint.
  expect(parsePairUrl("herdling://pair?h=10.0.0.5&c=123456&f=SHA256:" + "a+b/".repeat(10) + "xyz")).toBeNull();
});
