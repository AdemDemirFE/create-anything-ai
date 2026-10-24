using System.Net;
using System.Net.Http.Headers;
using Xunit;

namespace Stack35.Backend.Tests;

/// <summary>
/// REST integration tests over a real HTTP server (WebApplicationFactory):
/// register/login/protected-endpoint flows, 401, 429, envelope contract,
/// bounded algorithm input.
/// </summary>
public sealed class ApiIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public ApiIntegrationTests(ApiFactory factory) => _factory = factory;

    private static string UniqueEmail() => $"user-{Guid.NewGuid():N}@example.com";

    [Fact]
    public async Task RegisterCreatesAccountAndReturnsEnvelope()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();

        var (response, body) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/register", new { email, password = "CorrectHorse1" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.True(body.Success);
        Assert.Null(body.Error);
        Assert.Equal(email, body.Data?.GetProperty("email").GetString());
        Assert.False(string.IsNullOrEmpty(body.Meta?.Timestamp));
        Assert.False(string.IsNullOrEmpty(body.Meta?.RequestId));
        Assert.True(response.Headers.Contains("X-Request-Id"));
    }

    [Fact]
    public async Task RegisterRejectsInvalidEmailAndWeakPassword()
    {
        var client = _factory.CreateClient();

        var (badEmail, badEmailBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/register", new { email = "not-an-email", password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.BadRequest, badEmail.StatusCode);
        Assert.False(badEmailBody.Success);
        Assert.Equal("VALIDATION_ERROR", badEmailBody.Error?.Code);
        Assert.Contains(badEmailBody.Error?.Details ?? [], d => d.Field == "email");

        var (weak, weakBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/register", new { email = UniqueEmail(), password = "short" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.Equal("VALIDATION_ERROR", weakBody.Error?.Code);
        Assert.Contains(weakBody.Error?.Details ?? [], d => d.Field == "password");
    }

    [Fact]
    public async Task DuplicateEmailIsRejectedWithoutLeakage()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });

        var (response, body) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/register", new { email, password = "CorrectHorse1" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("EMAIL_TAKEN", body.Error?.Code);
        // Safe message: no exception or internals leak.
        Assert.DoesNotContain("Exception", body.Error?.Message);
        Assert.DoesNotContain("at Stack35", body.Error?.Message);
    }

    [Fact]
    public async Task LoginSuccessSetsCookieAndUnlocksHome()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });

        var (login, loginBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/login", new { email, password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        Assert.Equal(email, loginBody.Data?.GetProperty("email").GetString());
        AssertHeaderContainsCookie(login.Headers, "stack35.session");

        var (home, homeBody) = await client.SendEnvelopeAsync(HttpMethod.Get, "/api/v1/home");
        Assert.Equal(HttpStatusCode.OK, home.StatusCode);
        Assert.True(homeBody.Success);
        Assert.Equal(email, homeBody.Data?.GetProperty("email").GetString());
        Assert.False(homeBody.Data?.GetProperty("demo").GetBoolean());
    }

    private static void AssertHeaderContainsCookie(HttpResponseHeaders headers, string cookieName)
    {
        var setCookie = headers.TryGetValues("Set-Cookie", out var values)
            ? string.Join(";", values)
            : string.Empty;
        Assert.Contains(cookieName, setCookie, StringComparison.Ordinal);
    }

    [Fact]
    public async Task WrongPasswordAndUnknownEmailAreIndistinguishable()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });

        var (wrongPassword, wrongBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/login", new { email, password = "IncorrectHorse1" });
        var (unknownEmail, unknownBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/login", new { email = UniqueEmail(), password = "IncorrectHorse1" });

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        Assert.Equal(wrongBody.Error?.Code, unknownBody.Error?.Code);
        Assert.Equal(wrongBody.Error?.Message, unknownBody.Error?.Message);
    }

    [Fact]
    public async Task ProtectedEndpointsRejectUnauthenticatedRequests()
    {
        var client = _factory.CreateClient();

        foreach (var path in new[] { "/api/v1/home", "/api/v1/me", "/api/v1/algorithm" })
        {
            var (response, body) = await client.SendEnvelopeAsync(HttpMethod.Get, path);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
            Assert.False(body.Success);
            Assert.Equal("UNAUTHORIZED", body.Error?.Code);
        }

        var (run, runBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/algorithm/run", new { algorithm = "fizzbuzz", input = "3" });
        Assert.Equal(HttpStatusCode.Unauthorized, run.StatusCode);
        Assert.Equal("UNAUTHORIZED", runBody.Error?.Code);
    }

    [Fact]
    public async Task LoginThrottleReturns429AfterRepeatedFailures()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });

        HttpStatusCode lastStatus = HttpStatusCode.OK;
        for (var attempt = 0; attempt < 11; attempt++)
        {
            var (response, body) = await client.SendEnvelopeAsync(
                HttpMethod.Post, "/api/v1/login", new { email, password = "IncorrectHorse1" });
            lastStatus = response.StatusCode;
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                Assert.Equal("RATE_LIMITED", body.Error?.Code);
                var retryAfter = response.Headers.RetryAfter?.Delta;
                Assert.NotNull(retryAfter);
                Assert.True(retryAfter!.Value > TimeSpan.Zero);
                return;
            }
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, lastStatus);
    }

    [Fact]
    public async Task SuccessfulLoginAfterFailuresDoesNotGetThrottled()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });

        // A few failures stay below the limit...
        for (var attempt = 0; attempt < 5; attempt++)
        {
            var (fail, _) = await client.SendEnvelopeAsync(
                HttpMethod.Post, "/api/v1/login", new { email, password = "IncorrectHorse1" });
            Assert.Equal(HttpStatusCode.Unauthorized, fail.StatusCode);
        }

        // ...then success clears the tally.
        var (ok, _) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/login", new { email, password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
    }

    [Fact]
    public async Task AlgorithmRunReturnsMeasuredDurationAndComplexity()
    {
        var client = await LoggedInClient();
        var (_, catalogBody) = await client.SendEnvelopeAsync(HttpMethod.Get, "/api/v1/algorithm");
        Assert.True(catalogBody.Success);
        Assert.Equal(4, catalogBody.Data?.GetArrayLength());

        var (run, body) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/algorithm/run", new { algorithm = "fizzbuzz", input = "15" });
        Assert.Equal(HttpStatusCode.OK, run.StatusCode);
        Assert.Equal("fizzbuzz", body.Data?.GetProperty("algorithmId").GetString());
        Assert.Contains("FizzBuzz", body.Data?.GetProperty("output").GetString());
        Assert.True(body.Data?.GetProperty("executionMs").GetDouble() >= 0);
        Assert.Equal("O(n)", body.Data?.GetProperty("complexity").GetString());
        Assert.NotNull(body.Meta?.ExecutionMs);
    }

    [Fact]
    public async Task AlgorithmRejectsUnknownAlgorithmAndOversizedInput()
    {
        var client = await LoggedInClient();

        var (unknown, unknownBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/algorithm/run", new { algorithm = "eval-user-code", input = "3" });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);
        Assert.Equal("UNKNOWN_ALGORITHM", unknownBody.Error?.Code);

        var (oversized, oversizedBody) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/algorithm/run",
            new { algorithm = "reverse", input = new string('x', 10_001) });
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.Equal("INPUT_TOO_LARGE", oversizedBody.Error?.Code);
        Assert.Contains("10000", oversizedBody.Error?.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LogoutInvalidatesTheSession()
    {
        var client = await LoggedInClient();

        var (homeBefore, _) = await client.SendEnvelopeAsync(HttpMethod.Get, "/api/v1/home");
        Assert.True(homeBefore.IsSuccessStatusCode);
        var (logout, logoutBody) = await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/logout");
        Assert.Equal(HttpStatusCode.OK, logout.StatusCode);
        Assert.True(logoutBody.Success);

        var (homeAfter, _) = await client.SendEnvelopeAsync(HttpMethod.Get, "/api/v1/home");
        Assert.Equal(HttpStatusCode.Unauthorized, homeAfter.StatusCode);
    }

    private async Task<HttpClient> LoggedInClient()
    {
        var client = _factory.CreateClient();
        var email = UniqueEmail();
        await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });
        var (login, _) = await client.SendEnvelopeAsync(
            HttpMethod.Post, "/api/v1/login", new { email, password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return client;
    }
}
