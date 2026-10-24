using System.Net;
using Microsoft.AspNetCore.SignalR.Client;
using Xunit;

namespace Stack35.Backend.Tests;

/// <summary>
/// Real SignalR hub integration: a genuine SignalR client connects to the
/// test server over WebSockets using the session cookie from a REST login,
/// receives run events published by the REST handler, and the unauthenticated
/// negotiate path is rejected.
/// </summary>
public sealed class RealtimeHubIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;

    public RealtimeHubIntegrationTests(ApiFactory factory) => _factory = factory;

    private static string UniqueEmail() => $"user-{Guid.NewGuid():N}@example.com";

    /// <summary>
    /// Registers and logs in through a real HttpClient whose cookie container
    /// captures the session cookie, then returns that container so the SignalR
    /// client can present the same cookie during negotiate/WebSocket upgrade.
    /// The handler is the TestServer's in-memory handler, so requests never
    /// need a real network socket.
    /// </summary>
    private async Task<(HttpClient Client, System.Net.CookieContainer Cookies)> RegisterAndLoginAsync()
    {
        // TestServer's in-memory handler wrapped in a cookie-delegating
        // handler: requests stay in-process and the session cookie is captured.
        var cookies = new System.Net.CookieContainer();
        var primary = _factory.Server.CreateHandler();
        var handler = new DelegatingHandlerCookieBridge(primary, cookies);
        var client = new HttpClient(handler) { BaseAddress = _factory.Server.BaseAddress };
        var email = UniqueEmail();
        var (registered, _) = await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/register",
            new { email, password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.Created, registered.StatusCode);
        var (login, _) = await client.SendEnvelopeAsync(HttpMethod.Post, "/api/v1/login",
            new { email, password = "CorrectHorse1" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        return (client, cookies);
    }

    private string HubUrl() =>
        new Uri(_factory.Server.BaseAddress, "/hubs/realtime").ToString()
            .Replace("http://", "ws://", StringComparison.Ordinal);

    private HubConnection BuildHubConnection(System.Net.CookieContainer cookies)
    {
        return new HubConnectionBuilder()
            .WithUrl(HubUrl(), options =>
            {
                // Present the authenticated session cookie to the hub endpoint
                // and route the negotiate/upgrade traffic through TestServer's
                // in-memory handler (no real socket required).
                options.Cookies = cookies;
                options.HttpMessageHandlerFactory = _ =>
                {
                    var bridge = new DelegatingHandlerCookieBridge(_factory.Server.CreateHandler(), cookies);
                    return bridge;
                };
                options.UseStatefulReconnect = false;
            })
            .Build();
    }

    [Fact]
    public async Task HubRejectsUnauthenticatedNegotiate()
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(HubUrl())
            .Build();

        await Assert.ThrowsAsync<HttpRequestException>(() => connection.StartAsync());
    }

    /// <summary>Stores request Set-Cookie values and echoes cookies on subsequent requests.</summary>
    private sealed class DelegatingHandlerCookieBridge : DelegatingHandler
    {
        private readonly System.Net.CookieContainer _cookies;

        public DelegatingHandlerCookieBridge(HttpMessageHandler inner, System.Net.CookieContainer cookies)
            : base(inner) => _cookies = cookies;

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = request.RequestUri!;
            var cookieHeader = _cookies.GetCookieHeader(uri);
            if (!string.IsNullOrEmpty(cookieHeader))
            {
                request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
            }
            var response = await base.SendAsync(request, cancellationToken);
            if (response.Headers.TryGetValues("Set-Cookie", out var setCookies))
            {
                foreach (var setCookie in setCookies)
                {
                    _cookies.SetCookies(uri, setCookie);
                }
            }
            return response;
        }
    }

    [Fact]
    public async Task AuthenticatedClientReceivesRunEventsFromRest()
    {
        var (client, cookies) = await RegisterAndLoginAsync();

        var connection = BuildHubConnection(cookies);
        var received = new TaskCompletionSource<System.Text.Json.JsonElement>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<System.Text.Json.JsonElement>("runEvent", evt =>
        {
            received.TrySetResult(evt);
        });

        await connection.StartAsync();
        try
        {
            Assert.Equal(HubConnectionState.Connected, connection.State);

            // Trigger a run over REST; the coordinator publishes to the user group.
            var (response, _) = await client.SendEnvelopeAsync(
                HttpMethod.Post, "/api/v1/algorithm/run", new { algorithm = "reverse", input = "abc" });
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);

            var evt = await received.Task.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.Equal("run.completed", evt.GetProperty("type").GetString());
            Assert.Equal("reverse", evt.GetProperty("algorithmId").GetString());
            Assert.True(evt.GetProperty("executionMs").GetDouble() >= 0);
            Assert.Equal("O(n)", evt.GetProperty("complexity").GetString());
        }
        finally
        {
            await connection.DisposeAsync();
        }
    }

    [Fact]
    public async Task PingReceivesPong()
    {
        var (_, cookies) = await RegisterAndLoginAsync();
        var connection = BuildHubConnection(cookies);

        var pong = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        connection.On<string>("pong", t => pong.TrySetResult(t));

        await connection.StartAsync();
        try
        {
            await connection.InvokeAsync("Ping");
            var serverTime = await pong.Task.WaitAsync(TimeSpan.FromSeconds(15));
            Assert.False(string.IsNullOrEmpty(serverTime));
        }
        finally
        {
            await connection.DisposeAsync();
        }
    }
}
