# Security architecture

Trust boundaries include template input, raw HTML, compiler plugins, middleware, request data, and serialized island payloads. Text and attributes escape by default; raw HTML requires application sanitization. Compiler plugins execute with build-host privileges.

SSR state must be request-local. Application stores can reintroduce leaks if created at module scope. See [RFC-0016](/rfcs/RFC-0016-security-model) and the repository `SECURITY.md`.
