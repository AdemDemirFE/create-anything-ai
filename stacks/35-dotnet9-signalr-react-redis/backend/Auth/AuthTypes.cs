using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace CreateAnything.Stack35.Auth;

/// <summary>Cookie scheme and session-policy constants shared by all auth code.</summary>
public static class AuthConstants
{
    public const string Scheme = "Stack35.Cookies";
    public const string CookieName = "stack35.session";
    public const int SessionLifetimeMinutes = 60;

    /// <summary>Valid credential rules — 10..128 chars, at least one letter and one digit.</summary>
    public const int MinPasswordLength = 10;
    public const int MaxPasswordLength = 128;

    public static string NormalizeEmail(string? email) => (email ?? string.Empty).Trim().ToLowerInvariant();

    public static bool IsEmailValid(string email) =>
        email.Length <= 254 &&
        System.Text.RegularExpressions.Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    public static bool IsPasswordValid(string password) =>
        password.Length >= MinPasswordLength &&
        password.Length <= MaxPasswordLength &&
        password.Any(char.IsLetter) &&
        password.Any(char.IsDigit);
}

/// <summary>
/// Minimal password hashing with PBKDF2 (SHA-256, 100k iterations, random salt).
/// Hashes are constant-time compared; a modern managed password hashing
/// algorithm is required by docs/PRODUCT_REQUIREMENTS.md section 6.
/// </summary>
public sealed class PasswordHasher
{
    private const int SaltSize = 16;
    private const int KeySize = 32;
    private const int Iterations = 100_000;

    public string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, KeySize);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(key)}";
    }

    public bool Verify(string password, string stored)
    {
        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != "pbkdf2-sha256" || !int.TryParse(parts[1], out var iterations))
        {
            return false;
        }
        var salt = Convert.FromBase64String(parts[2]);
        var expected = Convert.FromBase64String(parts[3]);
        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}

/// <summary>Persistence abstraction for users so tests can swap the store.</summary>
public interface IUserStore
{
    Task<bool> TryAddAsync(string email, string passwordHash);
    Task<StoredUser?> FindAsync(string email);
    Task<bool> DeleteAsync(string email);
}

public sealed record StoredUser(string Email, string PasswordHash, DateTimeOffset CreatedAt);

/// <summary>
/// In-memory user store (reference-app scope). Unique email is enforced by the
/// concurrent dictionary per docs/PRODUCT_REQUIREMENTS.md section 6.
/// </summary>
public sealed class InMemoryUserStore : IUserStore
{
    private readonly ConcurrentDictionary<string, StoredUser> _users = new(StringComparer.Ordinal);

    public Task<bool> TryAddAsync(string email, string passwordHash) =>
        Task.FromResult(_users.TryAdd(email, new StoredUser(email, passwordHash, DateTimeOffset.UtcNow)));

    public Task<StoredUser?> FindAsync(string email) =>
        Task.FromResult(_users.TryGetValue(email, out var user) ? user : null);

    public Task<bool> DeleteAsync(string email) => Task.FromResult(_users.TryRemove(email, out _));
}

/// <summary>
/// Demo-grade failed-login throttle keyed on email+IP: 10 failed attempts per
/// 60-second pinned window, then HTTP 429 with Retry-After until the window
/// expires. Successful logins reset the tally for their key. In-process only —
/// production deployments should enforce limits at the edge/proxy.
/// </summary>
public sealed class LoginThrottle
{
    public const int MaxFailedAttempts = 10;
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(60);
    public const int RetryAfterSeconds = 60;

    public enum ThrottleVerdict { Allowed, Blocked }

    private sealed record WindowState(int Count, DateTimeOffset WindowStart);

    private readonly ConcurrentDictionary<string, WindowState> _attempts = new(StringComparer.Ordinal);
    private readonly Func<DateTimeOffset> _now;

    public LoginThrottle(Func<DateTimeOffset>? clock = null) => _now = clock ?? (() => DateTimeOffset.UtcNow);

    public string Key(string email, string ip) => $"{email}|{ip}";

    /// <summary>Pre-check: reports whether a new attempt may proceed. Does not mutate state.</summary>
    public (ThrottleVerdict Verdict, int RetryAfter) Check(string key)
    {
        if (_attempts.TryGetValue(key, out var state) &&
            _now() - state.WindowStart < Window &&
            state.Count >= MaxFailedAttempts)
        {
            return (ThrottleVerdict.Blocked, RetryAfterSeconds);
        }
        return (ThrottleVerdict.Allowed, 0);
    }

    /// <summary>Records one failed attempt atomically.</summary>
    public void Fail(string key)
    {
        _attempts.AddOrUpdate(
            key,
            _ => new WindowState(1, _now()),
            (_, state) =>
                _now() - state.WindowStart >= Window
                    ? new WindowState(1, _now())   // window expired: start fresh
                    : new WindowState(state.Count + 1, state.WindowStart)); // pinned window
    }

    /// <summary>Successful login clears the tally so a legitimate user recovers immediately.</summary>
    public void Reset(string key) => _attempts.TryRemove(key, out _);

    public void Clear() => _attempts.Clear();
}
