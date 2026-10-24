using System.Text.Json;
using System.Text.Json.Serialization;

namespace CreateAnything.Stack35.Web;

/// <summary>
/// The repository-wide API envelope (docs/PRODUCT_REQUIREMENTS.md section 7):
/// <code>
/// { "success": true, "data": {...}, "error": null,
///   "meta": { "timestamp": "...", "execution_ms": 2.4, "request_id": "..." } }
/// { "success": false, "data": null,
///   "error": { "code": "...", "message": "...", "details": [ {"field": "...", "code": "..."} ] },
///   "meta": { ... } }
/// </code>
/// Errors carry a stable machine-readable code and a safe message; stack
/// traces never leave the process. execution_ms only appears where
/// measurement is meaningful (monotonic clock) and is otherwise omitted.
/// </summary>
public sealed record ApiEnvelope<T>(
    [property: JsonPropertyName("success")] bool Success,
    [property: JsonPropertyName("data")] T? Data,
    [property: JsonPropertyName("error")] ApiError? Error,
    [property: JsonPropertyName("meta")] EnvelopeMeta Meta)
{
    public static ApiEnvelope<T> Ok(T data, string requestId) =>
        new(true, data, null, EnvelopeMeta.Create(requestId));

    /// <summary>Envelope with measured duration from a monotonic clock timestamp.</summary>
    public static ApiEnvelope<T> OkMeasured(T data, long startedTimestamp, string requestId)
    {
        var ms = Math.Round((System.Diagnostics.Stopwatch.GetTimestamp() - startedTimestamp)
            * 1000.0 / System.Diagnostics.Stopwatch.Frequency, 1);
        return new ApiEnvelope<T>(true, data, null, EnvelopeMeta.Create(requestId, ms));
    }

    public static ApiEnvelope<T?> Fail(string code, string message, string requestId,
        IReadOnlyList<EnvelopeFieldError>? details = null, int statusCode = 400) =>
        new(false, default, new ApiError(code, message, details), EnvelopeMeta.Create(requestId));
}

public sealed record ApiError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("details")] IReadOnlyList<EnvelopeFieldError>? Details);

public sealed record EnvelopeFieldError(
    [property: JsonPropertyName("field")] string Field,
    [property: JsonPropertyName("code")] string Code);

/// <summary>Envelope meta block. execution_ms is null when not measured.</summary>
public sealed record EnvelopeMeta(
    [property: JsonPropertyName("timestamp")] string Timestamp,
    [property: JsonPropertyName("execution_ms")] double? ExecutionMs,
    [property: JsonPropertyName("request_id")] string RequestId)
{
    public static EnvelopeMeta Create(string requestId, double? executionMs = null) =>
        new(DateTimeOffset.UtcNow.ToString("o"), executionMs, requestId);
}

/// <summary>Validation failure carrying a stable field error to the envelope details.</summary>
public sealed class ValidationException : Exception
{
    public ValidationException(string field, string code)
        : base("The request contains invalid fields.")
    {
        Field = field;
        Code = code;
    }

    public string Field { get; }
    public string Code { get; }

    public static void ThrowIfInvalid(bool valid, string field, string code = "INVALID_FORMAT")
    {
        if (!valid)
        {
            throw new ValidationException(field, code);
        }
    }
}

/// <summary>Algorithm input exceeded the documented bound (10000 chars).</summary>
public sealed class InputTooLargeException : Exception
{
    public InputTooLargeException(int max)
        : base($"Input exceeds the maximum length of {max} characters.")
    {
        Max = max;
    }

    public int Max { get; }
}

/// <summary>Unknown algorithm id from the fixed catalog.</summary>
public sealed class UnknownAlgorithmException : Exception
{
    public UnknownAlgorithmException(string id)
        : base($"Unknown algorithm id: {id}")
    {
        Id = id;
    }

    public string Id { get; }
}
