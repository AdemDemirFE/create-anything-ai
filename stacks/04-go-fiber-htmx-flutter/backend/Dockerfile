# Stack 04 backend image (declarative; never built in the implementation
# environment - no Docker daemon. The first real build is its verification).
#
# Multi-stage: golang builder -> scratch runtime. No shell, no package
# manager, minimal attack surface. Static assets (htmx.min.js) and templates
# are embedded in the binary via go:embed.

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# CGO_ENABLED=0 -> fully static binary for the scratch image.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" \
    -o /out/backend ./cmd/backend

FROM scratch
# CA certificates are not needed: the reference backend makes no outbound
# TLS calls. Copy the user/group files to run as non-root.
COPY --from=build /etc/passwd /etc/passwd
COPY --from=build --chown=65532:65532 /out/backend /backend
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/backend"]
