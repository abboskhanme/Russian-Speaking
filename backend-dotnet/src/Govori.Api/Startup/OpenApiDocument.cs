using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization.Metadata;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing.Patterns;

namespace Govori.Api.Startup;

/// <summary>
/// Builds the OpenAPI 3.0 description of this host (docs/08 Faza 4.2) — the machine-readable
/// contract the frontend's <c>npm run check:contract</c> gate compares
/// <c>frontend/src/shared/api/types.ts</c> against.
///
/// <para><b>Why this is hand-rolled instead of Microsoft.AspNetCore.OpenApi or Swashbuckle.</b>
/// Both of those derive an operation's schemas from what the handler's signature PROMISES. Every
/// route in this codebase — 101 of them, across eight modules — returns a bare
/// <c>IResult</c> (<c>Results.Ok(dto)</c>); there is not one <c>TypedResults</c> and not one
/// <c>.Produces&lt;T&gt;()</c>. A generator fed those signatures emits operations whose response
/// bodies are empty, i.e. it emits everything EXCEPT the part this gate exists to check. Making
/// either package useful would mean annotating all 101 routes in the module files — a change to
/// eight modules made for the benefit of a document. So the document is built here instead, from
/// two sources that cannot go stale:
/// <list type="bullet">
///   <item><b>Paths</b> come from the live <see cref="EndpointDataSource"/> — the routes the host
///   really serves, with their real methods, route parameters and authorization metadata.</item>
///   <item><b>Schemas</b> come from <see cref="JsonSerializerOptions.GetTypeInfo"/> on the host's
///   OWN serializer options. <see cref="JsonPropertyInfo.Name"/> is not a re-derivation of the
///   naming policy — it IS the name System.Text.Json writes on the wire, snake_case policy,
///   <c>[JsonPropertyName]</c> overrides and all. That is what makes the gate trustworthy: if the
///   document were produced by a second implementation of the naming rules, it could drift away
///   from the wire independently and we would be comparing the wrong thing to the wrong thing.</item>
/// </list></para>
///
/// <para><b>What the document does NOT carry.</b> Response bodies, for the reason above. An
/// operation therefore says which route, which method, which parameters, which request body and
/// whether a bearer token is required — and answers "200 OK" without a shape. The shapes live in
/// <c>components.schemas</c>, which IS exhaustive: every public DTO in Govori.Contracts is there.
/// Wiring responses to schemas is the one thing that would need those 101 annotations, and the day
/// they exist this file should switch to <c>Microsoft.AspNetCore.OpenApi</c> and delete most of
/// itself.</para>
///
/// <para><b>No Swagger UI, deliberately.</b> Nothing here serves an explorer, so there is no
/// production toggle to get wrong — the surface that must not be exposed simply does not exist.
/// The JSON itself is served on <c>/openapi/v1.json</c> in Development only (see Program.cs).</para>
/// </summary>
public static class OpenApiDocument
{
    /// <summary>
    /// <c>dotnet run --project src/Govori.Api -- --emit-openapi &lt;path&gt;</c> writes the document
    /// and exits without ever calling <c>app.Run()</c>. The host is BUILT but not STARTED, so the
    /// emit needs no Postgres, no Redis and no S3 — which is the only reason CI can regenerate the
    /// file and diff it on a plain runner.
    /// </summary>
    public const string EmitArgument = "--emit-openapi";

    /// <summary>The document version. Bumped only when the SHAPE of this file changes.</summary>
    private const string DocumentVersion = "1.0.0";

    /// <summary>Every DTO the wire can carry lives in this one assembly (docs/07 §7.2).</summary>
    private static readonly Assembly ContractsAssembly = typeof(Govori.Contracts.MeResponse).Assembly;

    /// <summary>Returns the output path when <c>--emit-openapi &lt;path&gt;</c> was passed.</summary>
    public static string? EmitPath(string[] args)
    {
        var index = Array.IndexOf(args, EmitArgument);
        if (index < 0) return null;
        if (index + 1 >= args.Length)
            throw new ArgumentException($"{EmitArgument} needs an output path.");
        return args[index + 1];
    }

    /// <summary>
    /// Builds the document from the endpoints this host has registered and the serializer options
    /// it will answer with.
    /// </summary>
    /// <param name="endpoints">Every endpoint on the host, from its <see cref="EndpointDataSource"/>s.</param>
    /// <param name="wireOptions">
    /// The host's live <c>JsonSerializerOptions</c>. It is CLONED before any type is inspected:
    /// <c>GetTypeInfo</c> freezes the options it is called on, and freezing the running host's
    /// options as a side effect of describing them would be a nasty way to learn that lesson.
    /// </param>
    /// <param name="isService">
    /// Tells a handler parameter that is injected from DI apart from one that comes off the
    /// request. Without it every <c>SomeService svc</c> parameter would be described as a request
    /// body.
    /// </param>
    public static JsonObject Build(
        IEnumerable<Endpoint> endpoints,
        JsonSerializerOptions wireOptions,
        Func<Type, bool> isService)
    {
        var options = new JsonSerializerOptions(wireOptions);
        options.TypeInfoResolver ??= new DefaultJsonTypeInfoResolver();

        return new JsonObject
        {
            ["openapi"] = "3.0.3",
            ["info"] = new JsonObject
            {
                ["title"] = "Govori API",
                ["version"] = DocumentVersion,
                ["description"] =
                    "Generated from the running host's endpoint table and its own JsonSerializerOptions "
                    + "(backend-dotnet/src/Govori.Api/Startup/OpenApiDocument.cs). Property names are the "
                    + "exact wire names. Response bodies are intentionally absent — see that file.",
            },
            ["paths"] = BuildPaths(endpoints, options, isService),
            ["components"] = new JsonObject
            {
                ["securitySchemes"] = new JsonObject
                {
                    ["bearerAuth"] = new JsonObject
                    {
                        ["type"] = "http",
                        ["scheme"] = "bearer",
                        ["bearerFormat"] = "JWT",
                    },
                },
                ["schemas"] = BuildSchemas(options),
            },
        };
    }

    /// <summary>Serializes the document the way the committed file is written (stable + indented).</summary>
    public static string Serialize(JsonObject document) =>
        document.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";

    // ── Paths ───────────────────────────────────────────────────────────────

    private static JsonObject BuildPaths(
        IEnumerable<Endpoint> endpoints, JsonSerializerOptions options, Func<Type, bool> isService)
    {
        var paths = new SortedDictionary<string, JsonObject>(StringComparer.Ordinal);

        foreach (var endpoint in endpoints.OfType<RouteEndpoint>())
        {
            // A route that opts out of description is not part of the contract. This is what keeps
            // the committed document describing the API PRODUCTION serves even though the emit is
            // required to run with ASPNETCORE_ENVIRONMENT=Development (docs/09): the dev-only
            // one-tap login (see DevLoginEndpoints) is registered on that host and must not appear
            // here, or the file would stop being byte-identical between the two environments and
            // would start advertising routes production answers 404 for.
            if (endpoint.Metadata.GetMetadata<IExcludeFromDescriptionMetadata>()?.ExcludeFromDescription == true)
                continue;

            var template = Template(endpoint.RoutePattern);
            var methods = endpoint.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods;
            if (methods is null || methods.Count == 0) continue;

            if (!paths.TryGetValue(template, out var item))
                paths[template] = item = new JsonObject();

            var operation = BuildOperation(endpoint, options, isService);
            foreach (var method in methods)
            {
                var verb = method.ToLowerInvariant();
                // HEAD/OPTIONS are framework-added twins of a GET; describing them adds noise and
                // no contract.
                if (verb is "head" or "options" or "connect" or "trace") continue;
                // A route registered twice for the same verb is a bug worth seeing, not hiding —
                // but the LAST registration is what the router picks, so mirror that.
                item[verb] = operation.DeepClone();
            }
        }

        var result = new JsonObject();
        foreach (var (key, value) in paths)
            if (value.Count > 0)
                result[key] = value;
        return result;
    }

    /// <summary>
    /// The route as OpenAPI writes it: <c>{id}</c>, never <c>{id:guid}</c> and never
    /// <c>{id?}</c> — constraints and optionality are ASP.NET routing syntax, not path syntax.
    /// </summary>
    private static string Template(RoutePattern pattern)
    {
        var segments = pattern.PathSegments.Select(segment => string.Concat(segment.Parts.Select(part => part switch
        {
            RoutePatternLiteralPart literal => literal.Content,
            RoutePatternParameterPart parameter => "{" + parameter.Name + "}",
            RoutePatternSeparatorPart separator => separator.Content,
            _ => string.Empty,
        })));
        return "/" + string.Join('/', segments);
    }

    private static JsonObject BuildOperation(
        RouteEndpoint endpoint, JsonSerializerOptions options, Func<Type, bool> isService)
    {
        var operation = new JsonObject
        {
            ["summary"] = endpoint.DisplayName ?? endpoint.RoutePattern.RawText ?? string.Empty,
        };

        var routeParameters = endpoint.RoutePattern.Parameters
            .Select(p => p.Name)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var parameters = new JsonArray();
        JsonObject? requestBody = null;

        // Minimal APIs stash the handler's MethodInfo in the endpoint metadata; it is the only place
        // the parameter list survives after the delegate is compiled into a RequestDelegate.
        var handler = endpoint.Metadata.GetMetadata<MethodInfo>();
        foreach (var parameter in handler?.GetParameters() ?? [])
        {
            var name = parameter.Name;
            if (name is null) continue;
            var type = parameter.ParameterType;

            if (routeParameters.Contains(name))
            {
                parameters.Add(new JsonObject
                {
                    ["name"] = name,
                    ["in"] = "path",
                    ["required"] = true,
                    ["schema"] = SchemaFor(Underlying(type), options),
                });
                continue;
            }

            if (IsFrameworkParameter(type) || isService(type)) continue;

            if (parameter.GetCustomAttributes().OfType<IFromBodyMetadata>().Any() || !IsScalar(type, options))
            {
                requestBody ??= new JsonObject
                {
                    ["required"] = true,
                    ["content"] = new JsonObject
                    {
                        ["application/json"] = new JsonObject { ["schema"] = SchemaFor(type, options) },
                    },
                };
                continue;
            }

            parameters.Add(new JsonObject
            {
                ["name"] = name,
                ["in"] = "query",
                ["required"] = Nullable.GetUnderlyingType(type) is null && type.IsValueType,
                ["schema"] = SchemaFor(Underlying(type), options),
            });
        }

        if (parameters.Count > 0) operation["parameters"] = parameters;
        if (requestBody is not null) operation["requestBody"] = requestBody;

        // 200 without a shape. The shapes are in components.schemas — see the class remarks for why
        // an untyped IResult cannot say more than this.
        operation["responses"] = new JsonObject { ["200"] = new JsonObject { ["description"] = "OK" } };

        var anonymous = endpoint.Metadata.GetMetadata<IAllowAnonymous>() is not null;
        var authorized = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0;
        if (authorized && !anonymous)
            operation["security"] = new JsonArray { new JsonObject { ["bearerAuth"] = new JsonArray() } };

        return operation;
    }

    /// <summary>Parameters the framework fills in — never part of the HTTP contract.</summary>
    private static bool IsFrameworkParameter(Type type) =>
        type == typeof(HttpContext)
        || type == typeof(HttpRequest)
        || type == typeof(HttpResponse)
        || type == typeof(CancellationToken)
        || type == typeof(System.Security.Claims.ClaimsPrincipal)
        || type == typeof(IFormFile)
        || type == typeof(IFormFileCollection)
        || type == typeof(IFormCollection)
        || type == typeof(Stream)
        || typeof(IServiceProvider).IsAssignableFrom(type);

    // ── Schemas ─────────────────────────────────────────────────────────────

    private static JsonObject BuildSchemas(JsonSerializerOptions options)
    {
        var schemas = new JsonObject();
        foreach (var type in ContractTypes(options))
            schemas[type.Name] = RootSchema(type, options);
        return schemas;
    }

    /// <summary>
    /// Every public, serializable DTO in Govori.Contracts, ordered by name so the committed file
    /// only changes when the contract does. Static helper classes (CefrScale, PhoneNumbers, …) and
    /// interfaces carry no wire shape and are skipped, and so does a type with no JSON properties
    /// at all: Govori.Contracts also holds seam IMPLEMENTATIONS (NullGradingEvents), and describing
    /// one as an empty object would put a shape in the document that no response ever carries.
    /// </summary>
    private static IEnumerable<Type> ContractTypes(JsonSerializerOptions options) =>
        ContractsAssembly.GetExportedTypes()
            .Where(type => !type.IsInterface && !type.IsGenericTypeDefinition && !(type.IsAbstract && type.IsSealed))
            .Where(type => type.IsEnum || IsWireShape(options.GetTypeInfo(type)))
            .OrderBy(type => type.Name, StringComparer.Ordinal);

    private static bool IsWireShape(JsonTypeInfo info) =>
        info.Kind == JsonTypeInfoKind.Object && info.Properties.Count > 0;

    private static JsonObject RootSchema(Type type, JsonSerializerOptions options)
    {
        if (type.IsEnum) return EnumSchema(type, options);

        var info = options.GetTypeInfo(type);
        var properties = new JsonObject();
        var required = new JsonArray();

        // `required` = every non-nullable member, and a C# DEFAULT VALUE does not change that. This
        // host sets no DefaultIgnoreCondition, so System.Text.Json writes every property of every
        // response — `string PreferredLanguage = "uz"` is a default for CONSTRUCTION, never a reason
        // for the field to be absent from the JSON. Treating a defaulted parameter as optional here
        // was tried first and produced a page of warnings claiming the API "may omit" fields it
        // sends on every single response, which is the fastest way to teach people to ignore the
        // warnings. A body the CLIENT may send partially says so through nullability instead —
        // every partial-update DTO in this codebase is `string? X = null`.
        foreach (var property in info.Properties)
        {
            var nullable = IsNullable(property);
            properties[property.Name] = SchemaFor(Underlying(property.PropertyType), options, nullable);
            if (!nullable) required.Add(property.Name);
        }

        var schema = new JsonObject { ["type"] = "object", ["properties"] = properties };
        if (required.Count > 0) schema["required"] = required;
        return schema;
    }

    private static JsonObject EnumSchema(Type type, JsonSerializerOptions options)
    {
        var names = Enum.GetNames(type);
        // Whether an enum reaches the wire as "Ready" or as 0 is decided by whichever converter is
        // in play ([JsonConverter(typeof(JsonStringEnumConverter))] on the enum, a global converter,
        // or neither). Asking the serializer is the only answer that cannot be wrong.
        var first = Enum.GetValues(type).GetValue(0);
        var serialized = first is null ? "0" : JsonSerializer.Serialize(first, type, options);
        if (!serialized.StartsWith('"'))
            return new JsonObject { ["type"] = "integer", ["format"] = "int32" };

        var values = new JsonArray();
        foreach (var name in names)
            values.Add(JsonSerializer.Deserialize<string>(
                JsonSerializer.Serialize(Enum.Parse(type, name), type, options))!);
        return new JsonObject { ["type"] = "string", ["enum"] = values };
    }

    private static JsonObject SchemaFor(Type type, JsonSerializerOptions options, bool nullable = false)
    {
        type = Underlying(type);

        if (type.Assembly == ContractsAssembly && (type.IsEnum || IsWireShape(options.GetTypeInfo(type))))
        {
            var reference = new JsonObject { ["$ref"] = "#/components/schemas/" + type.Name };
            // OpenAPI 3.0 forbids siblings next to $ref, so a nullable reference has to be wrapped.
            return nullable
                ? new JsonObject { ["nullable"] = true, ["allOf"] = new JsonArray { reference } }
                : reference;
        }

        var schema = ScalarOrContainer(type, options);
        if (nullable) schema["nullable"] = true;
        return schema;
    }

    private static JsonObject ScalarOrContainer(Type type, JsonSerializerOptions options)
    {
        if (type == typeof(byte[])) return new JsonObject { ["type"] = "string", ["format"] = "byte" };

        var info = options.GetTypeInfo(type);
        switch (info.Kind)
        {
            case JsonTypeInfoKind.Enumerable when info.ElementType is not null:
                return new JsonObject
                {
                    ["type"] = "array",
                    ["items"] = SchemaFor(info.ElementType, options),
                };
            case JsonTypeInfoKind.Dictionary when info.ElementType is not null:
                return new JsonObject
                {
                    ["type"] = "object",
                    ["additionalProperties"] = SchemaFor(info.ElementType, options),
                };
            case JsonTypeInfoKind.Object:
                // A DTO from outside Govori.Contracts. Inlined rather than named: giving it a
                // components entry would invite the gate to compare a type the frontend never sees.
                return RootSchema(type, options);
        }

        if (type.IsEnum) return EnumSchema(type, options);

        return type switch
        {
            _ when type == typeof(string) => new JsonObject { ["type"] = "string" },
            _ when type == typeof(bool) => new JsonObject { ["type"] = "boolean" },
            _ when type == typeof(Guid) => new JsonObject { ["type"] = "string", ["format"] = "uuid" },
            _ when type == typeof(DateTime) || type == typeof(DateTimeOffset) =>
                new JsonObject { ["type"] = "string", ["format"] = "date-time" },
            _ when type == typeof(DateOnly) => new JsonObject { ["type"] = "string", ["format"] = "date" },
            _ when type == typeof(TimeOnly) || type == typeof(TimeSpan) =>
                new JsonObject { ["type"] = "string" },
            _ when type == typeof(Uri) => new JsonObject { ["type"] = "string", ["format"] = "uri" },
            _ when type == typeof(byte) || type == typeof(sbyte) || type == typeof(short)
                || type == typeof(ushort) || type == typeof(int) || type == typeof(uint) =>
                new JsonObject { ["type"] = "integer", ["format"] = "int32" },
            _ when type == typeof(long) || type == typeof(ulong) =>
                new JsonObject { ["type"] = "integer", ["format"] = "int64" },
            _ when type == typeof(float) || type == typeof(double) =>
                new JsonObject { ["type"] = "number", ["format"] = "double" },
            _ when type == typeof(decimal) => new JsonObject { ["type"] = "number" },
            // object / JsonNode / JsonElement — "any JSON", which is what the wire really allows.
            _ => new JsonObject(),
        };
    }

    private static bool IsScalar(Type type, JsonSerializerOptions options)
    {
        type = Underlying(type);
        if (type == typeof(string) || type.IsEnum || type.IsPrimitive) return true;
        if (type == typeof(Guid) || type == typeof(DateTime) || type == typeof(DateTimeOffset)
            || type == typeof(DateOnly) || type == typeof(TimeOnly) || type == typeof(decimal)) return true;
        return options.GetTypeInfo(type).Kind == JsonTypeInfoKind.None;
    }

    private static Type Underlying(Type type) => Nullable.GetUnderlyingType(type) ?? type;

    // NullabilityInfoContext is documented as not thread-safe; the emit is single-threaded and this
    // instance never escapes the class.
    private static readonly NullabilityInfoContext NullabilityContext = new();

    /// <summary>
    /// Whether the wire may carry <c>null</c> here. Read from the C# nullable annotation, which is
    /// the same thing the DTO's own declaration says — <c>string? Region</c> is a nullable field and
    /// <c>string Email</c> is not.
    /// </summary>
    private static bool IsNullable(JsonPropertyInfo property)
    {
        if (Nullable.GetUnderlyingType(property.PropertyType) is not null) return true;
        if (property.PropertyType.IsValueType) return false;

        return (property.AttributeProvider as MemberInfo) switch
        {
            PropertyInfo info => NullabilityContext.Create(info).ReadState == NullabilityState.Nullable,
            FieldInfo info => NullabilityContext.Create(info).ReadState == NullabilityState.Nullable,
            // No annotation to read ⇒ assume the permissive answer rather than inventing a guarantee.
            _ => true,
        };
    }
}
