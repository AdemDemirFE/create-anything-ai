# Reference Stack 02 backend image (multi-stage, JDK 25).
# NOTE: UNVERIFIED — no Docker daemon in the implementation environment; this
# file has never been executed. Uses a plain Maven image (no committed
# wrapper); review before first real run.

FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /workspace
COPY pom.xml ./
RUN mvn -q -B dependency:go-offline || true
COPY src/ src/
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /workspace/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
