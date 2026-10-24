using CreateAnything.Stack35.Algorithm;
using CreateAnything.Stack35.Auth;
using CreateAnything.Stack35.Web;
using Xunit;

namespace Stack35.Backend.Tests;

/// <summary>Unit tests for the pure engine + auth primitives (no HTTP).</summary>
public sealed class AlgorithmEngineTests
{
    [Theory]
    [InlineData(1, "1")]
    [InlineData(3, "1\n2\nFizz")]
    [InlineData(5, "1\n2\nFizz\n4\nBuzz")]
    [InlineData(15, "1\n2\nFizz\n4\nBuzz\nFizz\n7\n8\nFizz\nBuzz\n11\nFizz\n13\n14\nFizzBuzz")]
    public void FizzBuzzIsCorrect(int n, string expected) =>
        Assert.Equal(expected, AlgorithmRunner.Run("fizzbuzz", n.ToString()).Output);

    [Theory]
    [InlineData("racecar", true)]
    [InlineData("A man, a plan, a canal: Panama!", true)]
    [InlineData("hello", false)]
    public void PalindromeIgnoresCaseAndPunctuation(string input, bool expected)
    {
        var output = AlgorithmRunner.Run("palindrome", input).Output;
        Assert.Equal($"Input is {(expected ? "" : "not ")}a palindrome.", output);
    }

    [Fact]
    public void FibonacciFirstTen() =>
        Assert.Equal("0, 1, 1, 2, 3, 5, 8, 13, 21, 34",
            AlgorithmRunner.Run("fibonacci", "10").Output);

    [Fact]
    public void ReverseKeepsCharacters() =>
        Assert.Equal("321cba", AlgorithmRunner.Run("reverse", "abc123").Output);

    [Fact]
    public void UnknownAlgorithmIsRejected() =>
        Assert.Throws<UnknownAlgorithmException>(() => AlgorithmRunner.Run("eval-code", "3"));

    [Fact]
    public void OversizedInputIsRejected() =>
        Assert.Throws<InputTooLargeException>(() =>
            AlgorithmRunner.Run("reverse", new string('x', AlgorithmRunner.MaxInputLength + 1)));

    [Fact]
    public void EmptyInputIsRejectedAsValidation() =>
        Assert.Throws<ValidationException>(() => AlgorithmRunner.Run("reverse", string.Empty));

    [Theory]
    [InlineData("fizzbuzz", "0")]
    [InlineData("fizzbuzz", "1001")]
    [InlineData("fibonacci", "91")]
    [InlineData("fibonacci", "abc")]
    public void OutOfRangeOrNonNumericBoundedInputIsRejected(string algorithm, string input) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => AlgorithmRunner.Run(algorithm, input));

    [Fact]
    public void MeasuredDurationIsMonotonicClockNotBigO()
    {
        // The run reports wall-clock measured duration (>= 0) that is
        // independent of the declared O(n) complexity string; both travel
        // separately in the result. No microsecond-precision claim is made.
        var result = AlgorithmRunner.Run("fizzbuzz", "1000");
        Assert.True(result.ExecutionMs >= 0);
        Assert.Equal("O(n)", result.Complexity);
        Assert.Contains("multiples of 3", result.Explanation, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void CatalogIsFixedAndSafe()
    {
        var ids = AlgorithmCatalog.DescribeAll().Select(a => a.Id).ToArray();
        Assert.Equal(new[] { "fizzbuzz", "palindrome", "fibonacci", "reverse" }, ids);
        // No user-code execution path exists: only these ids are executable.
        Assert.All(ids, id => Assert.True(AlgorithmCatalog.Exists(id)));
        Assert.False(AlgorithmCatalog.Exists("eval"));
    }
}

public sealed class PasswordHasherTests
{
    [Fact]
    public void HashIsSaltedAndVerifiable()
    {
        var hasher = new PasswordHasher();
        var a = hasher.Hash("CorrectHorse1");
        var b = hasher.Hash("CorrectHorse1");
        Assert.NotEqual(a, b); // random salt
        Assert.StartsWith("pbkdf2-sha256$", a);
        Assert.True(hasher.Verify("CorrectHorse1", a));
        Assert.False(hasher.Verify("wrong", a));
    }
}

public sealed class LoginThrottleTests
{
    private static readonly DateTimeOffset Start = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void EleventhFailureWithinWindowIsBlocked()
    {
        var now = Start;
        var throttle = new LoginThrottle(() => now);
        var key = throttle.Key("a@b.co", "1.2.3.4");

        for (var i = 0; i < LoginThrottle.MaxFailedAttempts; i++)
        {
            throttle.Fail(key);
        }

        var (verdict, retryAfter) = throttle.Check(key);
        Assert.Equal(LoginThrottle.ThrottleVerdict.Blocked, verdict);
        Assert.Equal(LoginThrottle.RetryAfterSeconds, retryAfter);
    }

    [Fact]
    public void WindowExpiryAllowsRetryAgain()
    {
        var now = Start;
        var throttle = new LoginThrottle(() => now);
        var key = throttle.Key("a@b.co", "1.2.3.4");
        for (var i = 0; i < LoginThrottle.MaxFailedAttempts; i++)
        {
            throttle.Fail(key);
        }
        Assert.Equal(LoginThrottle.ThrottleVerdict.Blocked, throttle.Check(key).Verdict);

        now = Start.Add(LoginThrottle.Window).AddSeconds(1);
        Assert.Equal(LoginThrottle.ThrottleVerdict.Allowed, throttle.Check(key).Verdict);
    }

    [Fact]
    public void SuccessResetsTheTally()
    {
        var now = Start;
        var throttle = new LoginThrottle(() => now);
        var key = throttle.Key("a@b.co", "1.2.3.4");
        for (var i = 0; i < LoginThrottle.MaxFailedAttempts - 1; i++)
        {
            throttle.Fail(key);
        }
        throttle.Reset(key);
        Assert.Equal(LoginThrottle.ThrottleVerdict.Allowed, throttle.Check(key).Verdict);
    }

    [Fact]
    public void DifferentIpOrEmailIsASeparateIdentity()
    {
        var throttle = new LoginThrottle();
        var a = throttle.Key("a@b.co", "1.1.1.1");
        var b = throttle.Key("a@b.co", "2.2.2.2");
        for (var i = 0; i < LoginThrottle.MaxFailedAttempts; i++)
        {
            throttle.Fail(a);
        }
        Assert.Equal(LoginThrottle.ThrottleVerdict.Blocked, throttle.Check(a).Verdict);
        Assert.Equal(LoginThrottle.ThrottleVerdict.Allowed, throttle.Check(b).Verdict);
    }
}
