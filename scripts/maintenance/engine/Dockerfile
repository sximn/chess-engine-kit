# Rust 1.90.0, Debian bookworm, Linux amd64. Pin the architecture-specific image
# so ARM/macOS maintainers use the same compiler host as GitHub's Linux runners.
FROM rust:1.90.0-slim-bookworm@sha256:4f572135209e89d488fadb81d8a07309857f9b9c5280b54c85a44b71629e8cca
RUN rustup target add --toolchain 1.90.0 wasm32-unknown-unknown
ENV RUSTUP_TOOLCHAIN=1.90.0
