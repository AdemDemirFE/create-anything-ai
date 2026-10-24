# Stack 36 backend image. UNVERIFIED (like docker-compose.yml): never built
# in the verification session. Multi-stage, static binary, distroless-style
# runtime.
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/backend ./cmd/backend

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/backend /backend
EXPOSE 8080
ENTRYPOINT ["/backend"]
