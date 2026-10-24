using System.Security.Claims;
using CreateAnything.Stack35.Algorithm;
using CreateAnything.Stack35.Auth;
using CreateAnything.Stack35.Realtime;
using CreateAnything.Stack35.Web;
using Microsoft.AspNetCore.Authentication;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Cookie-based session authentication (HttpOnly, SameSite=Lax, Secure when the
// request is https). A minimal custom in-memory user store backs the ticket
// auth; ASP.NET Core Identity is deliberately NOT used (reference-app scope,
// documented in ARCHITECTURE.md).
// ---------------------------------------------------------------------------
builder.Services.AddAuthentication(AuthConstants.Scheme)
    .AddCookie(AuthConstants.Scheme, options =>
    {
        options.Cookie.Name = AuthConstants.CookieName;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.Path = "/";
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
        options.Cookie.IsEssential = true;
        options.ExpireTimeSpan = TimeSpan.FromMinutes(AuthConstants.SessionLifetimeMinutes);
        options.SlidingExpiration = true;
        // Protected endpoints must answer with envelope JSON, never redirects.
        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });
builder.Services.AddAuthorization();

// Failed-login throttle and user store (both in-process, see ARCHITECTURE.md).
builder.Services.AddSingleton<LoginThrottle>();
builder.Services.AddSingleton<IUserStore, InMemoryUserStore>();
builder.Services.AddSingleton<PasswordHasher>();
builder.Services.AddSingleton<IEventPublisher, RunCoordinator>();

// SignalR: in-memory fan-out. The Redis backplane is declared, not wired: the
// StackExchangeRedis package is referenced, but AddStacksRedis is intentionally
// not called yet (no Redis server available to verify; see verification.md §5).
builder.Services.AddSignalR(options =>
{
    options.EnableDetailedErrors = builder.Environment.IsDevelopment();
    options.MaximumReceiveMessageSize = 128 * 1024; // bounded hub input
});

var app = builder.Build();

// ---------------------------------------------------------------------------
// Request-id + envelope error handling: every response carries X-Request-Id;
// unexpected failures return the repository envelope with a stable code; stack
// traces never leave the process.
// ---------------------------------------------------------------------------
app.Use(async (context, next) =>
{
    var requestId = Guid.NewGuid().ToString("N");
    context.Response.Headers["X-Request-Id"] = requestId;
    try
    {
        await next(context);
    }
    catch (ValidationException ex)
    {
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            await context.Response.WriteAsJsonAsync(ApiEnvelope<object?>.Fail(
                "VALIDATION_ERROR", ex.Message, requestId,
                [new EnvelopeFieldError(ex.Field, ex.Code)]));
        }
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Unhandled exception on {Path}", context.Request.Path);
        if (!context.Response.HasStarted)
        {
            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            await context.Response.WriteAsJsonAsync(ApiEnvelope<object?>.Fail(
                "INTERNAL_ERROR", "An unexpected error occurred.", requestId));
        }
    }
});

app.UseAuthentication();
app.UseAuthorization();

// ---------------------------------------------------------------------------
// Health (public)
// ---------------------------------------------------------------------------
app.MapGet("/healthz", () => Results.Json(ApiEnvelope<object?>.Ok(new { status = "ok" }, NewRequestId())));

// ---------------------------------------------------------------------------
// REST: /api/v1 — envelope contract from docs/PRODUCT_REQUIREMENTS.md section 7
// ---------------------------------------------------------------------------
var api = app.MapGroup("/api/v1");

api.MapPost("/register", async (RegisterRequest request, IUserStore users, PasswordHasher hasher) =>
{
    var started = System.Diagnostics.Stopwatch.GetTimestamp();
    var email = AuthConstants.NormalizeEmail(request.Email);
    ValidationException.ThrowIfInvalid(AuthConstants.IsEmailValid(email), "email");
    ValidationException.ThrowIfInvalid(AuthConstants.IsPasswordValid(request.Password ?? string.Empty), "password", "WEAK_PASSWORD");

    if (!await users.TryAddAsync(email, hasher.Hash(request.Password ?? string.Empty)))
    {
        return Results.Json(
            ApiEnvelope<object?>.Fail("EMAIL_TAKEN", "An account with this email already exists.", NewRequestId()),
            statusCode: StatusCodes.Status409Conflict);
    }

    var body = new { email };
    return Results.Json(ApiEnvelope<object?>.OkMeasured(body, started, NewRequestId()),
        statusCode: StatusCodes.Status201Created);
});

api.MapPost("/login", async (LoginRequest request, HttpContext http, IUserStore users,
    PasswordHasher hasher, LoginThrottle throttle) =>
{
    var email = AuthConstants.NormalizeEmail(request.Email);
    var key = throttle.Key(email, http.Connection.RemoteIpAddress?.ToString() ?? "unknown");

    var (verdict, retryAfter) = throttle.Check(key);
    if (verdict == LoginThrottle.ThrottleVerdict.Blocked)
    {
        http.Response.Headers.RetryAfter = retryAfter.ToString();
        return Results.Json(
            ApiEnvelope<object?>.Fail("RATE_LIMITED", "Too many failed attempts. Please wait and try again.", NewRequestId()),
            statusCode: StatusCodes.Status429TooManyRequests);
    }

    var user = await users.FindAsync(email);
    var ok = user is not null && hasher.Verify(request.Password ?? string.Empty, user.PasswordHash);
    if (!ok)
    {
        throttle.Fail(key);
        // Identical code+message for unknown email vs wrong password: no
        // account enumeration (asserted by tests).
        return Results.Json(
            ApiEnvelope<object?>.Fail("INVALID_CREDENTIALS", "Invalid email or password.", NewRequestId()),
            statusCode: StatusCodes.Status401Unauthorized);
    }

    throttle.Reset(key);
    var identity = new ClaimsIdentity([new Claim(ClaimTypes.Name, user!.Email)], AuthConstants.Scheme);
    await http.SignInAsync(AuthConstants.Scheme, new ClaimsPrincipal(identity));
    return Results.Json(ApiEnvelope<object?>.Ok(new { email = user.Email }, NewRequestId()));
});
api.MapPost("/logout", async (HttpContext http) =>
{
    await http.SignOutAsync(AuthConstants.Scheme);
    return Results.Json(ApiEnvelope<object?>.Ok(new { loggedOut = true }, NewRequestId()));
});

api.MapGet("/me", (ClaimsPrincipal principal) => IsAuthenticated(principal)
    ? Results.Json(ApiEnvelope<object?>.Ok(new { email = principal.Identity!.Name }, NewRequestId()))
    : Results.Json(
        ApiEnvelope<object?>.Fail("UNAUTHORIZED", "Authentication is required.", NewRequestId()),
        statusCode: StatusCodes.Status401Unauthorized));

api.MapGet("/home", (ClaimsPrincipal principal) => IsAuthenticated(principal)
    ? Results.Json(ApiEnvelope<object?>.Ok(new
    {
        email = principal.Identity!.Name,
        demo = false,
        metrics = new[]
        {
            new { label = "Session", value = "active", unit = "state" },
            new { label = "Algorithms", value = "4", unit = "count" },
            new { label = "Realtime", value = "SignalR", unit = "channel" },
        },
        serverTime = DateTimeOffset.UtcNow.ToString("o"),
    }, NewRequestId()))
    : Results.Json(
        ApiEnvelope<object?>.Fail("UNAUTHORIZED", "Authentication is required.", NewRequestId()),
        statusCode: StatusCodes.Status401Unauthorized));

// ---------------------------------------------------------------------------
// Algorithm workbench (protected). Fixed catalog only; bounded input; monotonic
// measured duration reported separately from theoretical Big-O.
// ---------------------------------------------------------------------------
api.MapGet("/algorithm", (ClaimsPrincipal principal) => IsAuthenticated(principal)
    ? Results.Json(ApiEnvelope<object?>.Ok(AlgorithmCatalog.DescribeAll(), NewRequestId()))
    : Results.Json(
        ApiEnvelope<object?>.Fail("UNAUTHORIZED", "Authentication is required.", NewRequestId()),
        statusCode: StatusCodes.Status401Unauthorized));

api.MapPost("/algorithm/run", async (AlgorithmRunRequest request, ClaimsPrincipal principal,
    IEventPublisher publisher) =>
{
    if (!IsAuthenticated(principal))
    {
        return Results.Json(
            ApiEnvelope<object?>.Fail("UNAUTHORIZED", "Authentication is required.", NewRequestId()),
            statusCode: StatusCodes.Status401Unauthorized);
    }

    try
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        var result = AlgorithmRunner.Run(request.Algorithm, request.Input ?? string.Empty);
        await publisher.PublishAsync(principal.Identity!.Name ?? string.Empty, new RealtimeEvent(
            "run.completed", result.AlgorithmId, result.ExecutionMs, result.Complexity, DateTimeOffset.UtcNow));
        return Results.Json(ApiEnvelope<object?>.OkMeasured(result, started, NewRequestId()));
    }
    catch (UnknownAlgorithmException)
    {
        return Results.Json(
            ApiEnvelope<object?>.Fail("UNKNOWN_ALGORITHM", "Unknown algorithm id.", NewRequestId()),
            statusCode: StatusCodes.Status400BadRequest);
    }
    catch (InputTooLargeException ex)
    {
        return Results.Json(
            ApiEnvelope<object?>.Fail("INPUT_TOO_LARGE", ex.Message, NewRequestId()),
            statusCode: StatusCodes.Status400BadRequest);
    }
    catch (ArgumentOutOfRangeException)
    {
        return Results.Json(
            ApiEnvelope<object?>.Fail("VALIDATION_ERROR", "The request contains invalid fields.", NewRequestId(),
                [new EnvelopeFieldError("input", "OUT_OF_RANGE")]),
            statusCode: StatusCodes.Status400BadRequest);
    }
});

// ---------------------------------------------------------------------------
// SignalR hub (auth required). The SPA connects with the same session cookie.
// ---------------------------------------------------------------------------
app.MapHub<RealtimeHub>(RealtimeHub.HubPath).RequireAuthorization();

static string NewRequestId() => Guid.NewGuid().ToString("N");

static bool IsAuthenticated(ClaimsPrincipal principal) =>
    principal.Identity?.IsAuthenticated == true && !string.IsNullOrEmpty(principal.Identity?.Name);

app.Run();

// ---------------------------------------------------------------------------
// DTOs: request shapes are explicit records; the envelope comes from Web/.
// ---------------------------------------------------------------------------
public sealed record RegisterRequest(string Email, string Password);

public sealed record LoginRequest(string Email, string Password);

public sealed record AlgorithmRunRequest(string Algorithm, string Input);

/// <summary>Exposes Program for WebApplicationFactory-based integration tests.</summary>
public partial class Program;
