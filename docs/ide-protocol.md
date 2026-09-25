# IDE service protocol, version 1

The service consumes UTF-8 JSON-RPC 2.0 requests, one per line. LF and CRLF
are accepted; embedded newlines are JSON escapes. Requests have `jsonrpc`,
`id`, `method`, and `params`; each receives either `result` or an error with
`code` and `message`. Notifications and batch requests are not supported.
stdout contains only protocol messages; stderr is for logs. Maximum input
frame size is 4 MiB, with a nesting limit of 128; oversized input terminates
the service after an error so an incomplete frame cannot be reinterpreted.
The host also bounds request/response sizes and request wait time.

| Method | Parameters | Result |
|---|---|---|
| `initialize` | `{protocol: 1}` | `{protocol: 1, implementation: string}` |
| `ping` | Any JSON value | Same value |
| `workspace/open` | `{path: string}` | Canonical workspace `{path, name}` |
| `workspace/list` | `{path: string, showExcluded?: boolean}` | Entries `{path, name, directory, symlink}[]` |
| `shutdown` | `{}` | `null`, followed by clean exit |

Initialize before sending other methods. Incompatible protocol is `-32001`,
missing initialization `-32002`, workspace policy failure `-32010`, unknown
method `-32601`, invalid parameters `-32602`, malformed JSON `-32700`, and
I/O/service failures `-32000`. Invalid JSON does not destroy the session;
the next complete request is still processed. Error responses to malformed
JSON use a null ID. Duplicate JSON object keys and invalid Unicode scalars
are rejected.

Electron main owns initialize/shutdown. The preload exposes only approved
application requests, folder selection, and service status subscriptions;
the renderer cannot request arbitrary processes or raw IPC channels. Request
IDs and transport sequencing are host details. SML returns the domain data.

M2 adds document revisions and UTF-16 edit offsets. M3 adds build identities
and diagnostics; these methods are not implemented by version 1's M1 service.
