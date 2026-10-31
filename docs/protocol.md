# herdlingd protocol

The app talks to `herdlingd` on each host. This page lists the rules for both sides.

## Transport

- The app opens an SSH connection with the restricted SSH key.
- The key runs `herdlingd rpc`. The command reads and writes one JSON object per line.
- A line ends with `\n`. A JSON object never contains a raw newline.
- A request line is at most 34 MiB. A longer line gets a `bad_request` error. (Before `stt.make`, the limit was 16 MiB.)

## Messages

- Request: `{"id": 1, "method": "name", "params": {}}`. `params` is optional.
- Response: `{"id": 1, "result": {}}` or `{"id": 1, "error": {"code": "...", "message": "..."}}`.
- Event: `{"method": "event", "params": {"stream": "...", "data": {}}}`. A streaming method sends events until the app sends `rpc.cancel`.
- The `id` is a number chosen by the app. The response carries the same `id`.
- A line that is not valid JSON gets an error with `id` null.

## Error codes in use

`bad_request`, `unknown_method`, `not_found`, `not_installed`, `io_error`, `internal`, `timeout`, `herdr_unavailable`, `upstream_error`, `command_failed`, `no_command`, `bad_output`, `automate_failed`, `too_large`.

A `herdr.call` error can also carry a code from herdr itself.

## Method list

`hello` returns `methods`: every method name the host accepts. An older `herdlingd` does not send `methods`. In that case the app tries the call and falls back on `unknown_method`.

## Compatibility rules

An app and a host can run different versions. Follow these rules so they do not break each other.

- Add methods and fields only.
- Never rename or remove a method or a field.
- Never change the type or the meaning of a field.
- Make every new field optional on both sides.
- Ignore unknown params and unknown fields.
- Check `hello.methods` before you use a method added after this rule. Treat a missing `methods` as "unknown": try the call and fall back.
- When you add a method, add its name to `METHODS` in `companion/src/rpc.rs` and to `APP_METHODS` in `app/src/hosts/methods.ts`.

## Before an OTA update

An over-the-air update ships JavaScript only. It cannot ship native code.

1. Compare the native dependencies in `app/package.json` and the plugins in `app/app.json` with the oldest build still in use.
2. If a native module is new, ship a new build first.
3. Then send the OTA update.
