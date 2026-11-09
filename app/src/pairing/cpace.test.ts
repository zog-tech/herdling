// The shared vectors: companion/tests/cpace.rs checks the same file.
import vectors from "../../../protocol/fixtures/cpace-ristretto255.json";

import {
  calculateGenerator,
  equalBytes,
  fromHex,
  generatorString,
  hmacSha512,
  isValidShare,
  iskIr,
  lvCat,
  macKey,
  prependLen,
  scalarFromRandom,
  scalarMult,
  scalarMultVfy,
  toHex,
  transcriptIr,
  utf8,
} from "./cpace";
import { ada, initiate, initiatorMacKey, LABEL, tagAMsg, tagBMsg } from "./pairV2";

const hex = (s: string) => fromHex(s, s.length / 2)!;

describe("CPace draft vectors", () => {
  it("prepend_len_and_lv_cat", () => {
    for (const c of vectors.prepend_len) expect(toHex(prependLen(hex(c.in)))).toBe(c.out);
    expect(toHex(lvCat(...vectors.lv_cat.in.map(hex)))).toBe(vectors.lv_cat.out);
  });

  it("ristretto255_sha512", () => {
    const d = vectors.draft;
    const [prs, ci, sid] = [hex(d.PRS), hex(d.CI), hex(d.sid)];
    expect(toHex(generatorString(prs, ci, sid))).toBe(d.generator_string);
    const g = calculateGenerator(prs, ci, sid);
    expect(toHex(g.toBytes())).toBe(d.g);
    const ya = scalarFromRandom(hex(d.ya))!;
    const yb = scalarFromRandom(hex(d.yb))!;
    const Ya = scalarMult(ya, g);
    const Yb = scalarMult(yb, g);
    expect(toHex(Ya)).toBe(d.Ya);
    expect(toHex(Yb)).toBe(d.Yb);
    const k = scalarMultVfy(ya, Yb)!;
    expect(toHex(k)).toBe(d.K);
    expect(toHex(scalarMultVfy(yb, Ya)!)).toBe(d.K);
    const [a, b] = [hex(d.ADa), hex(d.ADb)];
    expect(toHex(transcriptIr(Ya, a, Yb, b))).toBe(d.transcript_ir);
    expect(toHex(iskIr(sid, k, Ya, a, Yb, b))).toBe(d.ISK_IR);
  });

  it("scalar_mult_and_invalid_shares", () => {
    const s = scalarFromRandom(hex(vectors.scalar_mult.s))!;
    expect(toHex(scalarMultVfy(s, hex(vectors.scalar_mult.X))!)).toBe(vectors.scalar_mult.out);
    for (const bad of vectors.invalid_shares) {
      expect(scalarMultVfy(s, hex(bad))).toBeNull();
      expect(isValidShare(hex(bad))).toBe(false);
    }
    expect(isValidShare(new Uint8Array(31))).toBe(false);
  });

  it("zero_scalar_is_refused", () => {
    expect(scalarFromRandom(new Uint8Array(32))).toBeNull();
    const high = new Uint8Array(32);
    high[31] = 0xf0;
    expect(scalarFromRandom(high)).toBeNull();
  });
});

describe("Herdling pairing vector", () => {
  // Made by companion/src/pair_v2.rs: both sides must give the same messages, key and tags.
  const { input: i, output: o } = vectors.herdling;

  it("phone_side_matches_the_rust_vector", () => {
    const sid = hex(i.sid);
    const adb = hex(i.session);
    expect(toHex(calculateGenerator(utf8(i.code), LABEL, sid).toBytes())).toBe(o.g);
    const { y, ya } = initiate(i.code, sid, hex(i.ya_random))!;
    expect(toHex(ya)).toBe(o.ya);
    const key = initiatorMacKey(y, sid, ya, ada(i.device_id), hex(o.yb), adb)!;
    expect(toHex(key)).toBe(o.mac_key);
    const tagA = hmacSha512(key, tagAMsg(ya, ada(i.device_id), i.device_name, i.host_id, i.public_key));
    expect(toHex(tagA)).toBe(o.tag_a);
    const fields = { host_name: i.host_name, user: i.user, ssh_port: i.ssh_port, host_key_fingerprint: i.host_key_fingerprint };
    expect(toHex(hmacSha512(key, tagBMsg(hex(o.yb), adb, tagA, fields)))).toBe(o.tag_b);
  });

  it("host_side_matches_too", () => {
    // The host's scalar from yb_random gives the same Yb and key.
    const sid = hex(i.sid);
    const g = calculateGenerator(utf8(i.code), LABEL, sid);
    const yb = scalarFromRandom(hex(i.yb_random))!;
    expect(toHex(scalarMult(yb, g))).toBe(o.yb);
    const k = scalarMultVfy(yb, hex(o.ya))!;
    const isk = iskIr(sid, k, hex(o.ya), ada(i.device_id), hex(o.yb), hex(i.session));
    expect(toHex(macKey(sid, isk))).toBe(o.mac_key);
  });
});

describe("helpers", () => {
  it("utf8_matches_text_encoder", () => {
    for (const s of ["", "abc", "Sam’s iPhone", "日本", "😀", "é"]) {
      expect(Array.from(utf8(s))).toEqual(Array.from(new TextEncoder().encode(s)));
    }
  });

  it("hex_and_equal_bytes", () => {
    expect(fromHex("0aFf", 2)).toEqual(Uint8Array.from([10, 255]));
    expect(fromHex("0aF", 2)).toBeNull();
    expect(fromHex("zz", 1)).toBeNull();
    expect(equalBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 2]))).toBe(true);
    expect(equalBytes(Uint8Array.from([1, 2]), Uint8Array.from([1, 3]))).toBe(false);
    expect(equalBytes(Uint8Array.from([1]), Uint8Array.from([1, 0]))).toBe(false);
  });
});
