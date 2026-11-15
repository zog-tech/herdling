//! The herdr-core framed wire codec (`core::frame`).

use herdlingd::core::frame::{self, Decoder, Frame, TooLarge, CLOSE, CREDIT, DATA, HEADER, MAX_PAYLOAD, RESIZE};
use serde_json::json;

#[test]
fn encodes_the_header_in_little_endian() {
    let f = frame::encode(258, RESIZE, &[155, 0, 46, 0]);
    assert_eq!(&f[..HEADER], &[2, 1, 0, 0, RESIZE, 4, 0, 0, 0]);
    assert_eq!(&f[HEADER..], &[155, 0, 46, 0]);
}

#[test]
fn round_trips_each_kind() {
    let mut d = Decoder::default();
    for kind in 0..=6u8 {
        d.push(&frame::encode(7, kind, b"abc"));
        assert_eq!(d.next_frame().unwrap(), Some(Frame { channel: 7, kind, payload: b"abc".to_vec() }));
    }
    assert_eq!(d.next_frame().unwrap(), None);
}

#[test]
fn a_frame_split_at_any_byte_decodes_once() {
    let bytes = frame::encode(1, DATA, b"hello world");
    for cut in 0..bytes.len() {
        let mut d = Decoder::default();
        d.push(&bytes[..cut]);
        assert_eq!(d.next_frame().unwrap(), None, "cut {cut}");
        d.push(&bytes[cut..]);
        assert_eq!(d.next_frame().unwrap().unwrap().payload, b"hello world");
        assert_eq!(d.next_frame().unwrap(), None);
    }
}

#[test]
fn two_frames_in_one_push() {
    let mut d = Decoder::default();
    let mut bytes = frame::credit(3, 1000);
    bytes.extend(frame::close(3));
    d.push(&bytes);
    assert_eq!(d.next_frame().unwrap(), Some(Frame { channel: 3, kind: CREDIT, payload: 1000u32.to_le_bytes().to_vec() }));
    assert_eq!(d.next_frame().unwrap(), Some(Frame { channel: 3, kind: CLOSE, payload: vec![] }));
    assert_eq!(d.next_frame().unwrap(), None);
}

#[test]
fn an_oversized_frame_is_an_error() {
    let mut d = Decoder::default();
    let mut header = vec![0, 0, 0, 0, DATA];
    header.extend(((MAX_PAYLOAD + 1) as u32).to_le_bytes());
    d.push(&header);
    assert_eq!(d.next_frame(), Err(TooLarge(MAX_PAYLOAD + 1)));
}

#[test]
fn rpc_is_data_on_channel_zero() {
    let mut d = Decoder::default();
    d.push(&frame::rpc(&json!({"id": 1})));
    let f = d.next_frame().unwrap().unwrap();
    assert_eq!((f.channel, f.kind), (0, DATA));
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&f.payload).unwrap(), json!({"id": 1}));
}

#[test]
fn resize_payload_gives_the_size() {
    assert_eq!(frame::size(&[155, 0, 46, 0]), Some((155, 46)));
    assert_eq!(frame::size(&[155, 0, 46]), None);
}
