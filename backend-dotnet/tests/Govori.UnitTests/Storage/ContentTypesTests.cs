using Govori.Platform.Storage;

namespace Govori.UnitTests.Storage;

/// <summary>
/// Pins <see cref="ContentTypes.Essence"/> — the rule that keeps a MediaRecorder type such as
/// <c>audio/webm;codecs=opus</c> from ever reaching <c>PutObject</c>, where it broke the S3 signature
/// and failed every Chrome/Android answer with a 500. The storage round trip itself (that MinIO
/// accepts the result) is proven against the real container in <c>ObjectStorageTests</c>.
/// </summary>
public class ContentTypesTests
{
    [Theory]
    // The exact spellings browsers send for a recorded answer.
    [InlineData("audio/webm;codecs=opus", "audio/webm")]
    [InlineData("audio/webm; codecs=opus", "audio/webm")]
    [InlineData("audio/ogg;codecs=opus", "audio/ogg")]
    [InlineData("audio/mp4;codecs=mp4a.40.2", "audio/mp4")]
    // Already bare: unchanged.
    [InlineData("audio/webm", "audio/webm")]
    [InlineData("image/png", "image/png")]
    // Case and whitespace are not meaningful in a media type.
    [InlineData("  Audio/WebM ;codecs=opus", "audio/webm")]
    [InlineData("VIDEO/MP4", "video/mp4")]
    // Several parameters: everything from the FIRST ';' goes.
    [InlineData("audio/webm;codecs=opus;rate=48000", "audio/webm")]
    public void Strips_parameters_trims_and_lower_cases(string input, string expected)
        => Assert.Equal(expected, ContentTypes.Essence(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(";codecs=opus")]
    public void Nothing_usable_falls_back_to_octet_stream(string? input)
        => Assert.Equal(ContentTypes.Fallback, ContentTypes.Essence(input));
}
