/**
 * OpenTelemetry setup. Tracing is exported only when an OTLP endpoint is configured;
 * otherwise nothing is started and the OpenTelemetry API stays a no-op.
 */
export interface TracingHandle {
  enabled: boolean;
  shutdown: () => Promise<void>;
}

export async function startTracing(options: {
  serviceName: string;
  otlpEndpoint?: string | undefined;
}): Promise<TracingHandle> {
  if (!options.otlpEndpoint) {
    return { enabled: false, shutdown: async () => {} };
  }

  const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
  ]);

  const sdk = new NodeSDK({
    serviceName: options.serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${options.otlpEndpoint.replace(/\/$/, "")}/v1/traces` }),
    instrumentations: [new HttpInstrumentation()],
  });
  sdk.start();
  return { enabled: true, shutdown: () => sdk.shutdown() };
}
