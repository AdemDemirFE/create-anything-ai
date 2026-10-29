# Backend Dockerfile (multi-stage; not yet executed — Docker daemon unavailable
# in the implementation environment. Kept alongside docker-compose.yml which
# references it. Review before first real build.)

FROM maven:3.9-eclipse-temurin-25 AS build
WORKDIR /app
COPY pom.xml .
COPY .mvn .mvn
COPY mvnw .
RUN ./mvnw -q dependency:go-offline || true
COPY src src
RUN ./mvnw -q -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
