import { FINGERPRINT_RE } from "./pairUrl";
import { publicKeyFingerprint, sha256 } from "./keyFingerprint";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

test("sha256_matches_the_standard_vectors", () => {
  expect(hex(sha256(new Uint8Array()))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(hex(sha256(ascii("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // Two blocks: the padding goes into a second block.
  expect(hex(sha256(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")))).toBe(
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
  expect(hex(sha256(ascii("a".repeat(1000))))).toBe("41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
});

test("the_fingerprint_is_the_one_ssh_keygen_prints", () => {
  // A test key made for this test only. `ssh-keygen -lf` prints the fingerprint below.
  const line = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO0Sh7xYuSvvDyRFSaOKFYJvYEkpeGBxlCRcw8XIsnpZ herdling";
  const fp = publicKeyFingerprint(line);
  expect(fp).toBe("SHA256:Y/GzcvUJSvfNUQRkqvXvkdP/9LuUgYD/tPyRVetXZPA");
  expect(fp).toMatch(FINGERPRINT_RE);
  // The comment does not change the fingerprint.
  expect(publicKeyFingerprint(line.replace(" herdling", ""))).toBe(fp);
});

test("a_line_that_is_not_a_key_has_no_fingerprint", () => {
  expect(publicKeyFingerprint("")).toBeNull();
  expect(publicKeyFingerprint("ssh-ed25519")).toBeNull();
  expect(publicKeyFingerprint("ssh-ed25519 not*base64")).toBeNull();
  expect(publicKeyFingerprint("ssh-ed25519 AAAA=BBB")).toBeNull();
});
