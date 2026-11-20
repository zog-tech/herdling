//! Pure parts of the device mirror: device parsers, the pin, the stream parsers, the input rules
//! and the state machine.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use herdlingd::mirror::devices::{self, Kind, Platform};
use herdlingd::mirror::input::{self, Gesture, Key, PageInput, Phase, Recognizer};
use herdlingd::mirror::machine::{self, Effect, Input, Mode, State};
use herdlingd::mirror::pin;
use herdlingd::mirror::stream::{self, AnnexB, Demuxed, Frame, FrameCache, FrameKind, ScrcpyDemux, ViewerGate, Deliver};
use serde_json::json;

// ------------------------------------------------------------------ devices

#[test]
fn simctl_list_gives_booted_ios_simulators() {
    let v = json!({"devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
            {"udid": "269EBED9-ADE0-4AF4-9067-6B649B12BCCB", "name": "iPhone 17", "state": "Booted", "isAvailable": true,
             "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17"},
            {"udid": "11111111-2222-3333-4444-555555555555", "name": "Old", "state": "Shutdown"},
            {"udid": "not a udid; rm", "name": "Bad", "state": "Booted"}
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
            {"udid": "AAAAAAAA-2222-3333-4444-555555555555", "name": "Watch", "state": "Booted"}
        ]
    }});
    let d = devices::parse_simctl(&v, true);
    assert_eq!(d.len(), 1);
    assert_eq!(d[0].id, "ios:269EBED9-ADE0-4AF4-9067-6B649B12BCCB");
    assert_eq!(d[0].platform, Platform::Ios);
    assert_eq!(d[0].kind, Kind::Simulator);
    assert_eq!(d[0].os.as_deref(), Some("iOS 26.5"));
    assert_eq!(d[0].model.as_deref(), Some("iPhone-17"));
    assert!(d[0].video && d[0].input);
    // Without idb: screenshots and view only.
    let d = devices::parse_simctl(&v, false);
    assert!(!d[0].video && !d[0].input);
    assert!(devices::parse_simctl(&json!({}), true).is_empty());
}

#[test]
fn runtime_names() {
    assert_eq!(devices::runtime_name("com.apple.CoreSimulator.SimRuntime.iOS-17-0-1").as_deref(), Some("iOS 17.0.1"));
    assert_eq!(devices::runtime_name("com.apple.CoreSimulator.SimRuntime.iOS-x"), None);
    assert_eq!(devices::runtime_name("com.apple.CoreSimulator.SimRuntime.Foo-1-0"), None);
}

#[test]
fn adb_devices_marks_emulators_and_real_devices() {
    let text = "* daemon started successfully\nList of devices attached\n\
192.0.2.10:5555        device product:p model:Fire_TV device:d transport_id:2\n\
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:3\n\
emulator-5556          offline\n\
R5CT1234               unauthorized usb:1-1\n\
-bad                   device\n";
    let d = devices::parse_adb_devices(text);
    assert_eq!(d.len(), 2);
    assert_eq!(d[0].id, "android:192.0.2.10:5555");
    assert_eq!(d[0].kind, Kind::Device);
    assert_eq!(d[0].name, "Fire TV");
    assert_eq!(d[1].id, "android:emulator-5554");
    assert_eq!(d[1].kind, Kind::Emulator);
    assert_eq!(d[1].target(), "emulator-5554");
}

#[test]
fn ids_serials_and_avd_names() {
    assert!(devices::is_emulator("emulator-5554"));
    assert!(!devices::is_emulator("emulator-"));
    assert!(!devices::is_emulator("192.0.2.1:5555"));
    assert!(devices::valid_serial("192.0.2.1:5555"));
    assert!(!devices::valid_serial("a b"));
    assert!(!devices::valid_serial("-s"));
    assert!(!devices::valid_serial("a;rm"));
    assert!(devices::valid_udid("269EBED9-ADE0-4AF4-9067-6B649B12BCCB"));
    assert!(!devices::valid_udid("../x"));
    assert!(herdlingd::mirror::valid_device_id("ios:269EBED9-ADE0-4AF4-9067-6B649B12BCCB"));
    assert!(herdlingd::mirror::valid_device_id("android:emulator-5554"));
    assert!(!herdlingd::mirror::valid_device_id("android:"));
    assert!(!herdlingd::mirror::valid_device_id("windows:x"));
    assert_eq!(devices::parse_avd_name("Pixel_8\nOK\n").as_deref(), Some("Pixel_8"));
    assert_eq!(devices::parse_avd_name("OK\n"), None);
}

#[test]
fn idb_describe_gives_points() {
    let v = json!({"screen_dimensions": {"width": 1206, "height": 2622, "density": 3.0, "width_points": 402, "height_points": 874}});
    let s = devices::parse_idb_describe(&v).unwrap();
    assert_eq!((s.width_points, s.height_points, s.density), (402.0, 874.0, 3.0));
    assert!(devices::parse_idb_describe(&json!({"screen_dimensions": {"width_points": 0}})).is_none());
}

#[test]
fn tools_are_found_in_path_and_usual_folders() {
    let home = Path::new("/home/sam");
    let dirs = devices::search_dirs(Some("/usr/bin:/opt/x"), home, &["/opt/sdk".into()]);
    assert_eq!(dirs[0], PathBuf::from("/usr/bin"));
    assert!(dirs.contains(&PathBuf::from("/opt/sdk/platform-tools")));
    assert!(dirs.contains(&PathBuf::from("/home/sam/Library/Android/sdk/platform-tools")));
    assert!(dirs.contains(&PathBuf::from("/home/sam/.local/bin")));
    // No double entries.
    assert_eq!(dirs.iter().filter(|d| d.as_path() == Path::new("/usr/bin")).count(), 1);
    let have = ["/home/sam/Library/Android/sdk/platform-tools/adb", "/home/sam/.local/bin/idb", "/usr/bin/xcrun"];
    let t = devices::find_tools(&dirs, true, &|p| have.iter().any(|h| Path::new(h) == p));
    assert_eq!(t.adb.as_deref(), Some(Path::new("/home/sam/Library/Android/sdk/platform-tools/adb")));
    assert_eq!(t.idb.as_deref(), Some(Path::new("/home/sam/.local/bin/idb")));
    assert_eq!(t.xcrun.as_deref(), Some(Path::new("/usr/bin/xcrun")));
    assert!(t.idb_companion.is_none());
    // xcrun counts only on macOS.
    assert!(devices::find_tools(&dirs, false, &|p| have.iter().any(|h| Path::new(h) == p)).xcrun.is_none());
}

// ------------------------------------------------------------------ pin

#[test]
fn the_scrcpy_pin_is_valid() {
    let p = pin::embedded();
    assert!(p.valid());
    assert_eq!(p.url(), format!("https://github.com/Genymobile/scrcpy/releases/download/v{0}/scrcpy-server-v{0}", p.version));
    assert_eq!(p.path(Path::new("/home/sam")), PathBuf::from(format!("/home/sam/.local/share/herdling/scrcpy-server-v{}", p.version)));
}

#[test]
fn the_pin_checks_the_checksum() {
    let body = b"server bytes";
    let p = pin::ScrcpyPin { version: "5.0.1".into(), sha256: pin::sha256_hex(body) };
    assert!(p.valid());
    assert_eq!(pin::check_local(&p, Some(body)), pin::Have::Ready);
    assert_eq!(pin::check_local(&p, Some(b"changed")), pin::Have::Download);
    assert_eq!(pin::check_local(&p, None), pin::Have::Download);
    assert!(!pin::ScrcpyPin { version: "5.0".into(), sha256: p.sha256.clone() }.valid());
    assert!(!pin::ScrcpyPin { version: "5.0.1/../x".into(), sha256: p.sha256.clone() }.valid());
    assert!(!pin::ScrcpyPin { version: "5.0.1".into(), sha256: p.sha256.to_uppercase() }.valid());
}

// ------------------------------------------------------------------ stream

fn header(config: bool, key: bool, size: u32) -> Vec<u8> {
    let mut flags: u64 = 1234;
    if config {
        flags = 1 << 62;
    }
    if key {
        flags |= 1 << 61;
    }
    let mut v = flags.to_be_bytes().to_vec();
    v.extend_from_slice(&size.to_be_bytes());
    v
}

fn session(w: u32, h: u32) -> Vec<u8> {
    let mut v = vec![0x80, 0, 0, 0];
    v.extend_from_slice(&w.to_be_bytes());
    v.extend_from_slice(&h.to_be_bytes());
    v
}

#[test]
fn scrcpy_demux_reads_sessions_and_units_in_any_split() {
    let mut all = stream::CODEC_H264.to_be_bytes().to_vec();
    all.extend(session(720, 1280));
    all.extend(header(true, false, 3));
    all.extend([7, 7, 7]);
    all.extend(header(false, true, 2));
    all.extend([5, 5]);
    all.extend(header(false, false, 1));
    all.extend([1]);
    let want = vec![
        Demuxed::Session { width: 720, height: 1280 },
        Demuxed::Unit { key: true, data: vec![7, 7, 7, 5, 5] },
        Demuxed::Unit { key: false, data: vec![1] },
    ];
    for chunk in [1, 2, 5, 13, all.len()] {
        let mut d = ScrcpyDemux::default();
        let mut got = Vec::new();
        for part in all.chunks(chunk) {
            got.extend(d.feed(part).unwrap());
        }
        assert_eq!(got, want, "chunk {chunk}");
    }
}

#[test]
fn scrcpy_demux_refuses_bad_streams() {
    assert!(ScrcpyDemux::default().feed(&1u32.to_be_bytes()).is_err());
    assert!(ScrcpyDemux::default().feed(&0x6832_3635u32.to_be_bytes()).is_err());
    let mut big = stream::CODEC_H264.to_be_bytes().to_vec();
    big.extend(header(false, false, (stream::MAX_PACKET + 1) as u32));
    assert!(ScrcpyDemux::default().feed(&big).is_err());
}

fn nal(t: u8, body: &[u8]) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 1, t];
    v.extend_from_slice(body);
    v
}

#[test]
fn annexb_splits_access_units_and_puts_parameter_sets_on_key_frames() {
    let sps = nal(0x67, &[0x42, 0xc0, 0x1f]);
    let pps = nal(0x68, &[0xce]);
    let idr = nal(0x65, &[0x88, 1]);
    let p1 = nal(0x41, &[0x9a, 2]);
    let p2 = nal(0x41, &[0x9a, 3]);
    let idr2 = nal(0x65, &[0x88, 4]);
    let stream: Vec<u8> = [sps.clone(), pps.clone(), idr.clone(), p1.clone(), p2.clone(), idr2.clone()].concat();
    let mut a = AnnexB::default();
    let mut units = Vec::new();
    for part in stream.chunks(3) {
        units.extend(a.feed(part));
    }
    units.extend(a.flush());
    assert_eq!(units.len(), 4);
    assert!(units[0].key);
    assert_eq!(units[0].data, [sps.clone(), pps.clone(), idr].concat());
    assert!(!units[1].key && units[1].data == p1);
    assert_eq!(units[2].data, p2);
    // The second key frame has no SPS and PPS of its own: the last ones go in front.
    assert!(units[3].key);
    assert_eq!(units[3].data, [sps, pps, idr2].concat());
}

#[test]
fn annexb_skips_bytes_before_the_first_start_code() {
    let mut a = AnnexB::default();
    let mut units = a.feed(&[9, 9, 9]);
    units.extend(a.feed(&nal(0x65, &[0x88])));
    units.extend(a.flush());
    assert_eq!(units.len(), 1);
    assert_eq!(units[0].data, nal(0x65, &[0x88]));
}

#[test]
fn png_size_reads_the_header() {
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
    png.extend(1080u32.to_be_bytes());
    png.extend(2400u32.to_be_bytes());
    assert_eq!(stream::png_size(&png), Some((1080, 2400)));
    assert_eq!(stream::png_size(b"not a png at all, no header here"), None);
}

#[test]
fn frames_have_a_kind_and_a_flag_byte() {
    assert_eq!(stream::encode(FrameKind::H264, true, &[9]), vec![1, 1, 9]);
    assert_eq!(stream::encode(FrameKind::Jpeg, false, &[]), vec![2, 0]);
    assert_eq!(stream::encode(FrameKind::Png, true, &[]), vec![3, 1]);
}

fn frame(seq: u64, key: bool) -> Frame {
    Frame { seq, key, msg: vec![1, u8::from(key), seq as u8].into() }
}

#[test]
fn the_cache_starts_at_the_last_key_frame() {
    let mut c = FrameCache::default();
    c.push(frame(1, false));
    assert!(c.is_empty());
    c.push(frame(2, true));
    c.push(frame(3, false));
    c.push(frame(4, true));
    c.push(frame(5, false));
    assert_eq!(c.snapshot().iter().map(|f| f.seq).collect::<Vec<_>>(), vec![4, 5]);
    for s in 6..(6 + stream::CACHE_UNITS as u64) {
        c.push(frame(s, false));
    }
    // Too many units: the cache waits for the next key frame.
    assert!(c.is_empty());
}

#[test]
fn a_viewer_skips_sent_frames_and_waits_for_a_key_after_a_lag() {
    let mut g = ViewerGate::new(Some(5));
    assert_eq!(g.offer(&frame(5, false)), Deliver::Skip);
    assert_eq!(g.offer(&frame(6, false)), Deliver::Send);
    g.lagged();
    assert!(g.waits_for_key());
    assert_eq!(g.offer(&frame(9, false)), Deliver::Skip);
    assert_eq!(g.offer(&frame(10, true)), Deliver::Send);
    assert_eq!(g.offer(&frame(11, false)), Deliver::Send);
    let mut fresh = ViewerGate::new(None);
    assert_eq!(fresh.offer(&frame(1, false)), Deliver::Skip);
    assert_eq!(fresh.offer(&frame(2, true)), Deliver::Send);
}

// ------------------------------------------------------------------ input

#[test]
fn page_messages_are_checked() {
    assert_eq!(
        input::parse_page(r#"{"t":"touch","phase":"down","x":0.5,"y":1.7}"#),
        Some(PageInput::Touch { phase: Phase::Down, x: 0.5, y: 1.0 })
    );
    assert_eq!(input::parse_page(r#"{"t":"touch","phase":"jump","x":0,"y":0}"#), None);
    assert_eq!(input::parse_page(r#"{"t":"touch","phase":"up","x":"a","y":0}"#), None);
    assert_eq!(input::parse_page(r#"{"t":"key","key":"home"}"#), Some(PageInput::Key(Key::Home)));
    assert_eq!(input::parse_page(r#"{"t":"key","key":"reboot"}"#), None);
    assert_eq!(input::parse_page(r#"{"t":"text","text":"a\u0007b"}"#), Some(PageInput::Text("ab".into())));
    assert_eq!(input::parse_page(r#"{"t":"text","text":""}"#), None);
    let long = "x".repeat(5000);
    let Some(PageInput::Text(t)) = input::parse_page(&json!({"t": "text", "text": long}).to_string()) else { panic!() };
    assert_eq!(t.len(), input::MAX_TEXT);
    assert_eq!(input::parse_page(r#"{"t":"rotate"}"#), Some(PageInput::Rotate));
    assert_eq!(input::parse_page("not json"), None);
    assert!(input::is_key_frame_request(r#"{"t":"keyframe"}"#));
    assert!(!input::is_key_frame_request(r#"{"t":"key"}"#));
}

#[test]
fn the_recognizer_makes_taps_presses_and_swipes() {
    let mut r = Recognizer::default();
    assert_eq!(r.touch(Phase::Down, 0.5, 0.5, 0), None);
    assert_eq!(r.touch(Phase::Move, 0.505, 0.5, 50), None);
    assert_eq!(r.touch(Phase::Up, 0.505, 0.5, 100), Some(Gesture::Tap { x: 0.5, y: 0.5 }));
    r.touch(Phase::Down, 0.2, 0.2, 1000);
    assert_eq!(r.touch(Phase::Up, 0.2, 0.2, 1800), Some(Gesture::Swipe { x0: 0.2, y0: 0.2, x1: 0.2, y1: 0.2, ms: 800 }));
    r.touch(Phase::Down, 0.5, 0.8, 2000);
    assert_eq!(r.touch(Phase::Up, 0.5, 0.2, 2010), Some(Gesture::Swipe { x0: 0.5, y0: 0.8, x1: 0.5, y1: 0.2, ms: input::SWIPE_MIN_MS }));
    r.touch(Phase::Down, 0.5, 0.5, 3000);
    assert_eq!(r.touch(Phase::Cancel, 0.5, 0.5, 3010), None);
    assert_eq!(r.touch(Phase::Up, 0.5, 0.5, 3020), None);
    // An up with no down gives nothing.
    assert_eq!(Recognizer::default().touch(Phase::Up, 0.1, 0.1, 5), None);
}

#[test]
fn positions_map_to_pixels_and_points() {
    assert_eq!(input::to_px(0.0, 720), 0);
    assert_eq!(input::to_px(0.5, 720), 360);
    assert_eq!(input::to_px(1.0, 720), 719);
    assert_eq!(input::to_px(0.5, 0), 0);
    assert_eq!(input::to_points(0.5, 402.0), 201);
    assert_eq!(input::to_points(1.0, 402.0), 401);
    assert_eq!(input::ios_points((402.0, 874.0), Some((2622, 1206))), (874.0, 402.0));
    assert_eq!(input::ios_points((402.0, 874.0), None), (402.0, 874.0));
}

#[test]
fn scrcpy_control_messages_have_the_wire_layout() {
    let t = input::sc_touch(0, 360, 640, 720, 1280);
    assert_eq!(t.len(), 32);
    assert_eq!(&t[..2], &[2, 0]);
    assert_eq!(&t[2..10], &(-2i64).to_be_bytes());
    assert_eq!(&t[10..14], &360i32.to_be_bytes());
    assert_eq!(&t[14..18], &640i32.to_be_bytes());
    assert_eq!(&t[18..20], &720u16.to_be_bytes());
    assert_eq!(&t[20..22], &1280u16.to_be_bytes());
    assert_eq!(&t[22..24], &[0xff, 0xff]);
    assert_eq!(&input::sc_touch(1, 0, 0, 1, 1)[22..24], &[0, 0]);
    assert_eq!(input::sc_key(0, 3), vec![0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    let parts = input::sc_text(&"é".repeat(200));
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0][0], 1);
    assert_eq!(u32::from_be_bytes(parts[0][1..5].try_into().unwrap()), 300);
    assert_eq!(input::sc_rotate(), vec![11]);
    assert_eq!(input::sc_reset_video(), vec![17]);
}

#[test]
fn adb_and_idb_commands_are_safe() {
    assert_eq!(input::adb_text_command("it's a test").as_deref(), Some(r"input text 'it'\''s%sa%stest'"));
    assert_eq!(input::adb_text_command("$(reboot)").as_deref(), Some("input text '$(reboot)'"));
    assert_eq!(input::adb_text_command("ü"), None);
    assert_eq!(input::adb_gesture_command(&Gesture::Tap { x: 0.5, y: 0.5 }, 1080, 2400), "input tap 540 1200");
    assert_eq!(
        input::adb_gesture_command(&Gesture::Swipe { x0: 0.5, y0: 0.9, x1: 0.5, y1: 0.1, ms: 300 }, 1080, 2400),
        "input swipe 540 2160 540 240 300"
    );
    assert_eq!(input::adb_key_command(Key::Back).as_deref(), Some("input keyevent 4"));
    assert_eq!(input::adb_key_command(Key::Siri), None);
    assert_eq!(input::idb_gesture_args(&Gesture::Tap { x: 0.5, y: 0.5 }, (402.0, 874.0)), vec!["tap", "201", "437"]);
    assert_eq!(
        input::idb_gesture_args(&Gesture::Swipe { x0: 0.1, y0: 0.1, x1: 0.1, y1: 0.1, ms: 800 }, (402.0, 874.0)),
        vec!["tap", "--duration", "0.80", "40", "87"]
    );
    assert_eq!(input::idb_gesture_args(&Gesture::Swipe { x0: 0.5, y0: 0.9, x1: 0.5, y1: 0.1, ms: 250 }, (400.0, 800.0))[0], "swipe");
    assert_eq!(input::idb_button(Key::Home), Some("HOME"));
    assert_eq!(input::idb_button(Key::Back), None);
}

#[test]
fn scrcpy_server_arguments() {
    let a = herdlingd::mirror::source::scrcpy_args("5.0.1", 0x1234, 1280);
    assert_eq!(a[0], "5.0.1");
    assert!(a.contains(&"scid=00001234".to_string()));
    assert!(a.contains(&"max_size=1280".to_string()));
    assert!(a.contains(&"audio=false".to_string()));
    assert!(a.contains(&"tunnel_forward=true".to_string()));
    assert!(herdlingd::mirror::source::companion_stale("Failed to connect to companion at address"));
    assert!(!herdlingd::mirror::source::companion_stale("ok"));
}

// ------------------------------------------------------------------ machine

fn run(s: &State, i: Input, now: Instant) -> (State, Vec<Effect>) {
    let st = machine::step(s, i, now);
    (st.state, st.effects)
}

#[test]
fn a_viewer_starts_the_source_and_the_grace_stops_it() {
    let t0 = Instant::now();
    let s = State::new(Mode::Video, t0);
    let (s, fx) = run(&s, Input::Joined { video: true }, t0);
    assert_eq!(s.phase, machine::Phase::Starting { gen: 1 });
    assert_eq!(fx[0], Effect::StartSource { gen: 1, mode: Mode::Video });
    let (s, _) = run(&s, Input::Ready { gen: 1 }, t0);
    assert_eq!(s.phase, machine::Phase::Streaming { gen: 1 });
    let (s, fx) = run(&s, Input::Left, t0);
    assert!(fx.is_empty());
    assert!(matches!(s.phase, machine::Phase::Grace { gen: 1, .. }));
    // Back within the grace time: the same source.
    let (s, fx) = run(&s, Input::Joined { video: true }, t0 + Duration::from_secs(2));
    assert_eq!(s.phase, machine::Phase::Streaming { gen: 1 });
    assert!(!fx.iter().any(|f| matches!(f, Effect::StartSource { .. })));
    let (s, _) = run(&s, Input::Left, t0 + Duration::from_secs(3));
    let (s2, fx) = run(&s, Input::Tick, t0 + Duration::from_secs(5));
    assert!(fx.is_empty());
    assert_eq!(s2, s);
    let (s, fx) = run(&s, Input::Tick, t0 + Duration::from_secs(3) + machine::GRACE);
    assert_eq!(fx, vec![Effect::StopSource { gen: 1 }]);
    assert!(matches!(s.phase, machine::Phase::Waiting { .. }));
    // A new viewer starts a new generation.
    let (s, fx) = run(&s, Input::Joined { video: true }, t0 + Duration::from_secs(30));
    assert_eq!(fx[0], Effect::StartSource { gen: 2, mode: Mode::Video });
    assert_eq!(s.viewers, 1);
}

#[test]
fn old_generations_are_ignored() {
    let t0 = Instant::now();
    let (s, _) = run(&State::new(Mode::Video, t0), Input::Joined { video: true }, t0);
    let (s2, fx) = run(&s, Input::Ready { gen: 7 }, t0);
    assert_eq!(s2, s);
    assert!(fx.is_empty());
    let (s3, fx) = run(&s, Input::Ended { gen: 0, error: Some("x".into()), fallback: false }, t0);
    assert_eq!(s3, s);
    assert!(fx.is_empty());
}

#[test]
fn video_that_fails_at_start_falls_back_to_screenshots() {
    let t0 = Instant::now();
    let (s, _) = run(&State::new(Mode::Video, t0), Input::Joined { video: true }, t0);
    let (s, fx) = run(&s, Input::Ended { gen: 1, error: Some("no stream".into()), fallback: true }, t0);
    assert_eq!(s.mode, Mode::Shots);
    assert_eq!(fx[0], Effect::StartSource { gen: 2, mode: Mode::Shots });
    // A failure after the first frame is an error to the viewers, not a fallback.
    let (s, _) = run(&s, Input::Ready { gen: 2 }, t0);
    let (s, fx) = run(&s, Input::Ended { gen: 2, error: Some("gone".into()), fallback: true }, t0);
    assert!(matches!(s.phase, machine::Phase::Waiting { .. }));
    assert!(fx.contains(&Effect::Error("gone".into())));
}

#[test]
fn a_viewer_without_video_moves_the_session_to_screenshots() {
    let t0 = Instant::now();
    let (s, _) = run(&State::new(Mode::Video, t0), Input::Joined { video: true }, t0);
    let (s, _) = run(&s, Input::Ready { gen: 1 }, t0);
    let (s, fx) = run(&s, Input::Joined { video: false }, t0);
    assert_eq!(s.mode, Mode::Shots);
    assert_eq!(fx[..2], [Effect::StopSource { gen: 1 }, Effect::StartSource { gen: 2, mode: Mode::Shots }]);
    assert_eq!(s.viewers, 2);
}

#[test]
fn an_idle_server_stops_and_stop_ends_everything() {
    let t0 = Instant::now();
    let s = State::new(Mode::Shots, t0);
    let (s, fx) = run(&s, Input::Tick, t0 + machine::SERVER_IDLE);
    assert_eq!(s.phase, machine::Phase::Stopped);
    assert_eq!(fx, vec![Effect::Shutdown]);
    // A stopped session starts nothing.
    let (s2, fx) = run(&s, Input::Joined { video: true }, t0);
    assert!(fx.is_empty());
    assert_eq!(s2.phase, machine::Phase::Stopped);

    let (s, _) = run(&State::new(Mode::Shots, t0), Input::Joined { video: false }, t0);
    let (s, fx) = run(&s, Input::Stop, t0);
    assert_eq!(fx, vec![Effect::StopSource { gen: 1 }, Effect::Shutdown]);
    assert_eq!(s.phase, machine::Phase::Stopped);
    // Viewers in a waiting session keep the server open.
    let (s, _) = run(&State::new(Mode::Shots, t0), Input::Joined { video: false }, t0);
    let (s, _) = run(&s, Input::Ended { gen: 1, error: None, fallback: false }, t0);
    let (s, fx) = run(&s, Input::Tick, t0 + machine::SERVER_IDLE * 2);
    assert!(fx.is_empty());
    assert!(matches!(s.phase, machine::Phase::Waiting { .. }));
}
