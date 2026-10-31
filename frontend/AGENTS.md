# Frontend module

These instructions apply to `frontend/`.

- Work only in `frontend/` plus root workspace, documentation, or workflow files required by the frontend change.
- Never modify `backend/` in the same change.
- Keep render-loop state out of React state when a ref or Three.js object can update without rerendering.
- Preserve keyboard, pointer, and touch access for interaction changes.
- Run `npm run lint`, `npm run format:check`, `npm test`, and `npm run build` from this directory before finishing.
