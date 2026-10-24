package com.createanything.stack01;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.InputStream;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

/**
 * Guards the review fix for prod cookie hardening: {@code secure: true} must
 * live at {@code server.servlet.session.cookie.secure} in the prod profile
 * document. A previous version nested it under {@code spring.server.*},
 * which is not a Spring Boot property namespace - a silent no-op that kept
 * the session cookie non-secure in production. Also asserts
 * {@code server.max-http-request-header-size} sits under {@code server},
 * not under {@code spring.server}.
 */
class ProdCookieConfigTest {

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> loadYamlDocs() {
    Yaml yaml = new Yaml();
    try (InputStream in = ProdCookieConfigTest.class
        .getResourceAsStream("/application.yml")) {
      List<Object> docs = new java.util.ArrayList<>();
      yaml.loadAll(in).forEach(docs::add);
      return docs.stream().map(o -> (Map<String, Object>) o).toList();
    } catch (Exception e) {
      throw new IllegalStateException("application.yml not parseable", e);
    }
  }

  @Test
  void prodDocumentSetsSecureCookieUnderServerServletNamespace() {
    Map<String, Object> prod = loadYamlDocs().stream()
        .filter(d -> {
          Object spring = d.get("spring");
          if (!(spring instanceof Map<?, ?> springMap)) {
            return false;
          }
          Object activate = springMap.get("config");
          if (!(activate instanceof Map<?, ?> activateMap)) {
            return false;
          }
          Object profile = activateMap.get("activate");
          if (!(profile instanceof Map<?, ?> profileMap)) {
            return false;
          }
          Object onProfile = profileMap.get("on-profile");
          if (onProfile instanceof List<?> list) {
            return list.contains("prod");
          }
          return "prod".equals(onProfile);
        })
        .findFirst()
        .orElseThrow(() -> new AssertionError("prod profile document not found"));

    assertThat(prod).containsKey("server");
    Map<String, Object> server = (Map<String, Object>) prod.get("server");
    Map<String, Object> servlet = (Map<String, Object>) server.get("servlet");
    Map<String, Object> session = (Map<String, Object>) servlet.get("session");
    Map<String, Object> cookie = (Map<String, Object>) session.get("cookie");
    assertThat(cookie.get("secure")).as("prod session cookie must be secure").isEqualTo(true);
  }

  @Test
  void baseDocumentHasNoSpringServerNamespace() {
    Map<String, Object> base = loadYamlDocs().get(0);
    Map<String, Object> spring = (Map<String, Object>) base.get("spring");
    assertThat(spring).as("spring.server.* is not a Boot property namespace")
        .doesNotContainKey("server");

    Map<String, Object> server = castMap(base.get("server"));
    assertThat(server.get("max-http-request-header-size")).as("header size under server")
        .isEqualTo("8KB");
  }

  private static Map<String, Object> castMap(Object o) {
    return (Map<String, Object>) o;
  }
}
