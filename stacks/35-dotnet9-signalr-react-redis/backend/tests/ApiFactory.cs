using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CreateAnything.Stack35.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Stack35.Backend.Tests;

/// <summary>
/// Shared factory for integration tests. Register/user state lives in the
/// in-memory store, so each test class uses a unique factory instance and
/// unique emails to stay isolated.
/// </summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder) =>
        builder.UseSetting("ENVIRONMENT", "Development");
}

/// <summary>Envelope shapes per docs/PRODUCT_REQUIREMENTS.md section 7.</summary>
public sealed class Envelope
{
    public bool Success { get; set; }
    public JsonElement? Data { get; set; }
    public ApiErrorBody? Error { get; set; }
    public EnvelopeMetaBody? Meta { get; set; }
}

public sealed class ApiErrorBody
{
    public string Code { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public List<EnvelopeFieldErrorBody>? Details { get; set; }
}

public sealed class EnvelopeFieldErrorBody
{
    public string Field { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
}

public sealed class EnvelopeMetaBody
{
    public string Timestamp { get; set; } = string.Empty;
    public double? ExecutionMs { get; set; }
    public string RequestId { get; set; } = string.Empty;
}

public static class HttpClientExtensions
{
    /// <summary>Snake-case naming policy matches the backend envelope contract.</summary>
    public static readonly JsonSerializerOptions EnvelopeOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    public static async Task<(HttpResponseMessage Response, Envelope Body)> SendEnvelopeAsync(
        this HttpClient client, HttpMethod method, string path, object? payload = null)
    {
        using var request = new HttpRequestMessage(method, path)
        {
            Content = payload is null
                ? null
                : JsonContent.Create(payload),
        };
        var response = await client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<Envelope>(EnvelopeOptions);
        Assert.NotNull(body);
        return (response, body!);
    }
}
