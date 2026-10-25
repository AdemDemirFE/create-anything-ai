# Stack 02 web client

Angular 20 standalone app implementing the four-screen contract
(register / login / home / algorithm workbench) against the Stack 02
Spring Boot backend.

```bash
npm install
npm start        # dev server (http://localhost:4200)
npm test         # vitest unit tests (jsdom, fetch mocked)
npm run build    # production bundle → dist/stack02-web
```

The app lives on its OWN prefix/origin; API calls go to `/api/v1/**`
(envelope contract, see `../ARCHITECTURE.md`). Data updates use POLLING
only — server push (SSE/WebSocket) is deliberately absent from this stack.
