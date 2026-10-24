using System.Collections.Concurrent;
using CreateAnything.Stack35.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace CreateAnything.Stack35.Realtime;

/// <summary>Event published to the authenticated user's group after a run.</summary>
public sealed record RealtimeEvent(
    string Type,
    string AlgorithmId,
    double ExecutionMs,
    string Complexity,
    DateTimeOffset OccurredAt);

/// <summary>
/// Coordinates user-scoped realtime events. In the default configuration this
/// is the in-memory fan-out used by both REST handlers and the hub. A Redis
/// backplane (see README) would only change how groups are replicated across
/// processes, not this interface.
/// </summary>
public interface IEventPublisher
{
    Task PublishAsync(string userEmail, RealtimeEvent evt);
}

/// <summary>REST-side publisher that forwards events into the SignalR hub runtime.</summary>
public sealed class RunCoordinator : IEventPublisher
{
    private readonly IHubContext<RealtimeHub> _hub;

    public RunCoordinator(IHubContext<RealtimeHub> hub) => _hub = hub;

    public async Task PublishAsync(string userEmail, RealtimeEvent evt) =>
        await _hub.Clients.Group(RealtimeHub.GroupFor(userEmail))
            .SendAsync("runEvent", evt);
}

/// <summary>
/// Authenticated SignalR hub. The endpoint requires authorization (mapped with
/// RequireAuthorization), and each connection joins a per-user group so events
/// emitted by REST handlers reach exactly that user's open clients.
/// </summary>
[Authorize]
public sealed class RealtimeHub : Hub
{
    public const string HubPath = "/hubs/realtime";

    public override async Task OnConnectedAsync()
    {
        var email = Context.User?.Identity?.Name;
        if (!string.IsNullOrEmpty(email))
        {
            await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(email));
        }
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var email = Context.User?.Identity?.Name;
        if (!string.IsNullOrEmpty(email))
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, GroupFor(email));
        }
        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>Client-initiated heartbeat; echoes a pong with server time.</summary>
    public Task Ping() => Clients.Caller.SendAsync("pong", DateTimeOffset.UtcNow.ToString("o"));

    public static string GroupFor(string email) => $"user:{email}";
}
