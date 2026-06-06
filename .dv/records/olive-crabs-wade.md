---
type: feat!
packages:
  - '@dv-cli/clipc'
notes: >-
  rawCliErrorPayloadSchema and rawCliErrorEnvelopeSchema are no longer exported from the package
  surface — Zod is now an implementation detail of @dv-cli/clipc. Consumers validate error envelopes
  with the new parseCliErrorEnvelope / safeParseCliErrorEnvelope functions, which return plain
  (Zod-free) results (CliErrorEnvelopeParseResult). The RawCliErrorEnvelope / RawCliErrorPayload
  contract interfaces are unchanged. The raw schema remains available to the in-repo JSON Schema
  generator via the ./internal/error-schema subpath.
---

Stop exporting the raw Zod error schemas; validate via Zod-free parser functions instead
