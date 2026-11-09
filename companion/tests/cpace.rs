//! CPace and pairing v2 against the shared vectors in `protocol/fixtures/cpace-ristretto255.json`.
//! The app's Jest tests check the same file, so both sides compute the same values.

use curve25519_dalek::scalar::Scalar;
use herdlingd::cpace;
use herdlingd::pair_v2::{self, hex, unhex};
use serde_json::{json, Value};

fn fixture() -> Value {
    let text = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../protocol/fixtures/cpace-ristretto255.json"));
    serde_json::from_str(text).unwrap()
}

fn bytes(v: &Value) -> Vec<u8> {
    let s = v.as_str().unwrap();
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn b32(v: &Value) -> [u8; 32] {
    bytes(v).try_into().unwrap()
}

#[test]
fn prepend_len_and_lv_cat() {
    let f = fixture();
    for case in f["prepend_len"].as_array().unwrap() {
        assert_eq!(hex(&cpace::prepend_len(&bytes(&case["in"]))), case["out"].as_str().unwrap());
    }
    let parts: Vec<Vec<u8>> = f["lv_cat"]["in"].as_array().unwrap().iter().map(bytes).collect();
    let refs: Vec<&[u8]> = parts.iter().map(Vec::as_slice).collect();
    assert_eq!(hex(&cpace::lv_cat(&refs)), f["lv_cat"]["out"].as_str().unwrap());
}

#[test]
fn draft_ristretto255_vectors() {
    let d = &fixture()["draft"];
    let (prs, ci, sid) = (bytes(&d["PRS"]), bytes(&d["CI"]), bytes(&d["sid"]));
    assert_eq!(hex(&cpace::generator_string(&prs, &ci, &sid)), d["generator_string"].as_str().unwrap());
    let g = cpace::calculate_generator(&prs, &ci, &sid);
    assert_eq!(hex(g.compress().as_bytes()), d["g"].as_str().unwrap());

    // The draft scalars are below 2^252, so the sampling mask keeps them as they are.
    let ya = cpace::scalar_from_random(b32(&d["ya"])).unwrap();
    let yb = cpace::scalar_from_random(b32(&d["yb"])).unwrap();
    let ya_pub = cpace::scalar_mult(&ya, &g);
    let yb_pub = cpace::scalar_mult(&yb, &g);
    assert_eq!(hex(&ya_pub), d["Ya"].as_str().unwrap());
    assert_eq!(hex(&yb_pub), d["Yb"].as_str().unwrap());

    let ka = cpace::scalar_mult_vfy(&ya, &yb_pub).unwrap();
    let kb = cpace::scalar_mult_vfy(&yb, &ya_pub).unwrap();
    assert_eq!(hex(&ka), d["K"].as_str().unwrap());
    assert_eq!(ka, kb);

    let (ada, adb) = (bytes(&d["ADa"]), bytes(&d["ADb"]));
    assert_eq!(hex(&cpace::transcript_ir(&ya_pub, &ada, &yb_pub, &adb)), d["transcript_ir"].as_str().unwrap());
    let isk = cpace::isk_ir(&sid, &ka, &ya_pub, &ada, &yb_pub, &adb);
    assert_eq!(hex(&isk), d["ISK_IR"].as_str().unwrap());
}

#[test]
fn scalar_mult_and_invalid_shares() {
    let f = fixture();
    let s = Scalar::from_bytes_mod_order(b32(&f["scalar_mult"]["s"]));
    let out = cpace::scalar_mult_vfy(&s, &bytes(&f["scalar_mult"]["X"])).unwrap();
    assert_eq!(hex(&out), f["scalar_mult"]["out"].as_str().unwrap());
    for bad in f["invalid_shares"].as_array().unwrap() {
        assert!(cpace::scalar_mult_vfy(&s, &bytes(bad)).is_none(), "{bad}");
        assert!(!cpace::is_valid_share(&bytes(bad)));
    }
}

/// The full pairing v2 exchange with fixed random values, as both sides compute it.
fn herdling_exchange(i: &Value) -> Value {
    let s = |k: &str| i[k].as_str().unwrap().to_string();
    let sid = bytes(&i["sid"]);
    let adb = bytes(&i["session"]);
    let ada = pair_v2::ada(&s("device_id"));
    let (ya, ya_pub) = pair_v2::initiate(&s("code"), &sid, b32(&i["ya_random"])).unwrap();
    let host = pair_v2::respond(&s("code"), &sid, &ya_pub, &ada, &adb, b32(&i["yb_random"])).unwrap();
    let phone_key = pair_v2::initiator_mac_key(&ya, &sid, &ya_pub, &ada, &host.yb, &adb).unwrap();
    assert_eq!(phone_key, host.mac_key, "both sides get the same key");
    let tag_a = cpace::hmac_sha512(
        &phone_key,
        &pair_v2::tag_a_msg(&ya_pub, &ada, &s("device_name"), &s("host_id"), &s("public_key")),
    );
    let port = u16::try_from(i["ssh_port"].as_u64().unwrap()).unwrap();
    let fp = i["host_key_fingerprint"].as_str();
    let tag_b = cpace::hmac_sha512(
        &host.mac_key,
        &pair_v2::tag_b_msg(&host.yb, &adb, &tag_a, &s("host_name"), &s("user"), port, fp),
    );
    let g = cpace::calculate_generator(s("code").as_bytes(), pair_v2::LABEL, &sid);
    json!({
        "g": hex(g.compress().as_bytes()),
        "ya": hex(&ya_pub),
        "yb": hex(&host.yb),
        "mac_key": hex(&host.mac_key),
        "tag_a": hex(&tag_a),
        "tag_b": hex(&tag_b),
    })
}

#[test]
fn herdling_pairing_vector() {
    let h = &fixture()["herdling"];
    let got = herdling_exchange(&h["input"]);
    assert_eq!(got, h["output"], "computed: {got:#}");
}

#[test]
fn wrong_code_gives_another_key() {
    let h = &fixture()["herdling"]["input"];
    let sid = bytes(&h["sid"]);
    let adb = bytes(&h["session"]);
    let ada = pair_v2::ada("d1");
    let (ya, ya_pub) = pair_v2::initiate("111111", &sid, b32(&h["ya_random"])).unwrap();
    let host = pair_v2::respond("222222", &sid, &ya_pub, &ada, &adb, b32(&h["yb_random"])).unwrap();
    let phone_key = pair_v2::initiator_mac_key(&ya, &sid, &ya_pub, &ada, &host.yb, &adb).unwrap();
    assert_ne!(phone_key, host.mac_key);
}

#[test]
fn hex_round_trip() {
    assert_eq!(unhex::<2>("0aFf"), Some([0x0a, 0xff]));
    assert_eq!(unhex::<2>("0aF"), None);
    assert_eq!(unhex::<2>("0g00"), None);
    assert_eq!(unhex::<1>("+1"), None);
    assert_eq!(hex(&[0, 255]), "00ff");
}
