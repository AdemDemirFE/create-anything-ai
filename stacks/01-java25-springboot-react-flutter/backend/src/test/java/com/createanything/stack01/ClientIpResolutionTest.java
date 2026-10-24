package com.createanything.stack01.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Guards the trusted-proxy decision for login throttling (review round 3):
 * X-Forwarded-For must NOT be trusted unconditionally - a spoofable header
 * would let an attacker rotate fake identities and bypass the throttle.
 *
 * <ul>
 *   <li>Default (no trusted proxies): XFF ignored, remoteAddr is the identity.</li>
 *   <li>Spoofed XFF from an untrusted peer: still remoteAddr.</li>
 *   <li>Trusted-proxy mode: first UNTRUSTED hop walking right-to-left.</li>
 * </ul>
 */
class ClientIpResolutionTest {

  private AuthService serviceWithProxies(String... proxies) {
    AuthService service = new AuthService(null, null, null);
    ReflectionTestUtils.setField(service, "trustedProxies",
        List.of(proxies));
    return service;
  }

  private HttpServletRequest request(String remoteAddr, String xff) {
    HttpServletRequest request = mock(HttpServletRequest.class);
    when(request.getRemoteAddr()).thenReturn(remoteAddr);
    if (xff != null) {
      when(request.getHeader("X-Forwarded-For")).thenReturn(xff);
    }
    return request;
  }

  private String clientIp(AuthService service, HttpServletRequest request) throws Exception {
    Method method = AuthService.class.getDeclaredMethod("clientIp", HttpServletRequest.class);
    method.setAccessible(true);
    return (String) method.invoke(service, request);
  }

  @Test
  void defaultConfigIgnoresXffAndUsesRemoteAddr() throws Exception {
    // (a) No trusted proxies: the request's remote address throttles, even
    // when the client sends an XFF header full of fresh fake identities.
    AuthService service = serviceWithProxies(); // default: empty

    assertThat(clientIp(service, request("203.0.113.7", "1.2.3.4, 5.6.7.8")))
        .isEqualTo("203.0.113.7");
    assertThat(clientIp(service, request("203.0.113.7", null)))
        .isEqualTo("203.0.113.7");
  }

  @Test
  void spoofedXffFromUntrustedPeerDoesNotCreateANewIdentity() throws Exception {
    // (b) Trusted proxies are configured, but the immediate peer is NOT one
    // of them: the header cannot be trusted, remoteAddr stays the identity.
    AuthService service = serviceWithProxies("10.0.0.5");

    assertThat(clientIp(service, request("198.51.100.9", "1.2.3.4, 5.6.7.8")))
        .isEqualTo("198.51.100.9");
  }

  @Test
  void trustedProxyModeUsesFirstUntrustedHopFromTheRight() throws Exception {
    // (c) The connection really comes from a configured proxy: walk XFF
    // right-to-left, skipping trusted hops.
    AuthService service = serviceWithProxies("10.0.0.5", "10.0.0.6");

    // Peer 10.0.0.5 is trusted; rightmost XFF hop is the client reported by
    // that proxy and is NOT a trusted proxy itself -> that is the identity.
    assertThat(clientIp(service, request("10.0.0.5", "198.51.100.1")))
        .isEqualTo("198.51.100.1");

    // Chained trusted proxies (10.0.0.5 -> 10.0.0.6 -> client): the first
    // untrusted hop from the right wins, even with attacker-controlled
    // entries to its left.
    assertThat(clientIp(service, request("10.0.0.5", "9.9.9.9, 10.0.0.6, 198.51.100.2")))
        .isEqualTo("198.51.100.2");

    // All hops trusted (chained proxies only): fall back to the leftmost.
    AuthService chained = serviceWithProxies("10.0.0.5", "10.0.0.6", "10.0.0.7");
    assertThat(clientIp(chained, request("10.0.0.5", "10.0.0.6, 10.0.0.7")))
        .isEqualTo("10.0.0.6");

    // Prefix configuration ("10.0." matches 10.1.2.3).
    AuthService prefix = serviceWithProxies("10.0.");
    assertThat(clientIp(prefix, request("10.0.0.9", "198.51.100.3")))
        .isEqualTo("198.51.100.3");

    // No XFF from a trusted peer: peer itself is the identity.
    assertThat(clientIp(service, request("10.0.0.5", null)))
        .isEqualTo("10.0.0.5");
  }
}
