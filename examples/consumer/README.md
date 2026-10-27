# Package verification harness

This project exercises the installed tarball, including history, repeated
cancellation, consumer-owned offline caching and Capacitor. The smaller
`examples/minimal` project is the recommended learning example.

From the repository root run `npm run test:consumer`, then `npm run test:browser`.
Verification uses isolated copies in `.build/consumers/` and leaves this source
directory and its lockfile untouched. For manual use, run
`npm run example:setup -- consumer`, then `npm --prefix examples/consumer run dev`.
