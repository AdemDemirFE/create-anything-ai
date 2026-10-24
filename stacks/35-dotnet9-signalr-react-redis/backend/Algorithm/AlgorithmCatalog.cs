using System.Diagnostics;
using System.Text;
using CreateAnything.Stack35.Web;

namespace CreateAnything.Stack35.Algorithm;

/// <summary>
/// Fixed, safe algorithms only. The workbench never evaluates user-supplied
/// code; callers select from this catalog by id. Each algorithm declares its
/// theoretical Big-O so the API can distinguish measured duration (monotonic
/// Stopwatch) from the complexity claim.
/// </summary>
public static class AlgorithmCatalog
{
    public sealed record AlgorithmInfo(
        string Id, string Name, string Complexity, string Explanation);

    public static IReadOnlyList<AlgorithmInfo> DescribeAll() =>
    [
        new("fizzbuzz", "FizzBuzz", "O(n)",
            "Prints one line per number from 1 to n; multiples of 3 become Fizz, of 5 Buzz, of both FizzBuzz."),
        new("palindrome", "Palindrome check", "O(n)",
            "Checks whether the input text reads the same forwards and backwards (case-insensitive)."),
        new("fibonacci", "Fibonacci sequence", "O(n)",
            "Returns the first n Fibonacci numbers using an iterative loop."),
        new("reverse", "Reverse text", "O(n)",
            "Reverses the characters of the input text."),
    ];

    public static bool Exists(string id) =>
        DescribeAll().Any(a => a.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    /// <summary>Parses a bounded integer input; throws ArgumentOutOfRangeException out of range.</summary>
    public static int ParseBoundedInt(string input, int min, int max)
    {
        if (!int.TryParse(input.Trim(), out var value) || value < min || value > max)
        {
            throw new ArgumentOutOfRangeException(nameof(input),
                $"Input must be an integer between {min} and {max}.");
        }
        return value;
    }
}

/// <summary>
/// Executes only catalog algorithms on bounded input. Timing uses
/// <see cref="Stopwatch"/> (monotonic); the API reports measured duration and
/// separately the theoretical complexity. Max input: 10,000 characters.
/// </summary>
public static class AlgorithmRunner
{
    public const int MaxInputLength = 10_000;

    public sealed record RunResult(
        string AlgorithmId, string Output, double ExecutionMs, string Complexity, string Explanation);

    public static RunResult Run(string algorithmId, string input)
    {
        if (string.IsNullOrWhiteSpace(algorithmId))
        {
            throw new UnknownAlgorithmException(algorithmId ?? string.Empty);
        }
        var info = AlgorithmCatalog.DescribeAll()
            .FirstOrDefault(a => a.Id.Equals(algorithmId.Trim(), StringComparison.OrdinalIgnoreCase))
            ?? throw new UnknownAlgorithmException(algorithmId);

        if (string.IsNullOrEmpty(input))
        {
            throw new ValidationException("input", "REQUIRED");
        }
        if (input.Length > MaxInputLength)
        {
            throw new InputTooLargeException(MaxInputLength);
        }

        var start = Stopwatch.GetTimestamp();
        var output = info.Id switch
        {
            "fizzbuzz" => FizzBuzz(input),
            "palindrome" => Palindrome(input),
            "fibonacci" => Fibonacci(input),
            "reverse" => Reverse(input),
            _ => throw new UnknownAlgorithmException(algorithmId),
        };
        var ms = Math.Round((Stopwatch.GetTimestamp() - start) * 1000.0 / Stopwatch.Frequency, 1);
        return new RunResult(info.Id, output, ms, info.Complexity, info.Explanation);
    }

    private static string FizzBuzz(string input)
    {
        var n = AlgorithmCatalog.ParseBoundedInt(input, 1, 1000);
        var sb = new StringBuilder();
        for (var i = 1; i <= n; i++)
        {
            if (i > 1)
            {
                sb.Append('\n');
            }
            if (i % 15 == 0) sb.Append("FizzBuzz");
            else if (i % 3 == 0) sb.Append("Fizz");
            else if (i % 5 == 0) sb.Append("Buzz");
            else sb.Append(i);
        }
        return sb.ToString();
    }

    private static string Palindrome(string input)
    {
        var cleaned = new string(input.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray());
        var reversed = new string(cleaned.Reverse().ToArray());
        var isPalindrome = cleaned.Equals(reversed, StringComparison.Ordinal);
        return "Input is " + (isPalindrome ? "" : "not ") + "a palindrome.";
    }

    private static string Fibonacci(string input)
    {
        var n = AlgorithmCatalog.ParseBoundedInt(input, 1, 90);
        var parts = new List<string>(n);
        long a = 0, b = 1;
        for (var i = 0; i < n; i++)
        {
            parts.Add(a.ToString());
            (a, b) = (b, a + b);
        }
        return string.Join(", ", parts);
    }

    private static string Reverse(string input) => new(input.Reverse().ToArray());
}
