# open-clipper patch

Upstream `sherpa-onnx` 1.13.4 deserializes `OfflineRecognizerResult` without the
`lang` field that Whisper JSON includes. This vendored copy adds:

```rust
#[serde(default)]
pub lang: String,
```

so Whisper language lock can read the detected code after the first chunk(s).
