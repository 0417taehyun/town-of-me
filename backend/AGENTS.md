# Backend module

These instructions apply to `backend/`.

- Work only in `backend/` plus root workspace, documentation, or workflow files required by the backend change.
- Never modify `frontend/` in the same change.
- Keep authentication, authorization, validation, and storage boundaries explicit and testable.
- Do not add a provider implementation or external service call without its credentials, failure behavior, and test boundary being defined.
- Run `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` from this directory before finishing.
