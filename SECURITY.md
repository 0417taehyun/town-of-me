# Security

Report a vulnerability privately through GitHub's **Report a vulnerability** button on this repository's Security tab,
not in a public issue. Include the affected route or file, how to reproduce it, and the impact you expect.

The areas that matter most are admin sign-in and sessions (`backend/src/auth.ts`, `backend/src/linkedin.ts`), the admin
list, input validation at the API (`backend/src/validation.ts`, `backend/src/town.ts`), and anything that renders
admin- or visitor-written text or links in the browser.

Only the latest code on the default branch is supported.
