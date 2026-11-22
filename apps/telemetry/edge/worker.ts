// Telemetry's edge function: the Tail Worker of the network's other Workers (`core/edge/edge.js`). Each request
// one of them handled for the network becomes a span, kept with what servers recorded, so a request that failed or
// hung at the edge, and one that never reached a server, is in Telemetry too. A span has the request's route, status,
// duration and outcome, and what the Worker said of it in a line of its own, `{"telemetry": …}`: its `traceparent`,
// which a server it reached carried on, the `parent` it came in with, `attributes` such as `one.server`, an
// `error`, and the `start` and `end` of what it did, where that's less than the Worker's whole run. A line with a
// `name` is a span of that name, kept whatever ran it, as the network's updater says each step of an update. Nothing else of a
// request is kept: no query, header, cookie, body or other log line, so never a token or a code.
//
// Each span is made with OpenTelemetry's own SDK, with the trace and span ids the Worker said it carried on, and is
// gathered a minute at a time in a Durable Object as OTLP's protobuf, which OpenTelemetry's own serializer writes. A
// minute is kept as one blob of Telemetry's own artifact for the network, `otlp/<day>/<hour>/<to>-edge-<bytes>.traces`,
// as a server's export is (`Telemetry.Store`): protobuf's messages one after another are one message, so it's one
// export request.
//
// What's watched from outside is whether the network's servers answer: each call the edge passes on either reaches one
// or says none of them answered (`core/edge/relay/relay.ts`). While none does, nothing on a server records or alerts,
// so the Durable Object holds the outage, from the first request no server answered to the first a server answered or
// a ready server said it's here, and keeps it then as a span of its own, `network unreachable`, that the first server
// back reads (`Telemetry.Alerts`, the `server` alert).
import { DurableObject, env } from "cloudflare:workers";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace, type Context } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { ProtobufTraceSerializer } from "@opentelemetry/otlp-transformer";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider, type IdGenerator } from "@opentelemetry/sdk-trace";

declare global {
  namespace Cloudflare {
    interface Env {
      BATCH: DurableObjectNamespace<Batch>;
      OWN: { write(name: string, data: Uint8Array): Promise<boolean> };
    }
  }
}

/** What a Worker says of a request, in a line `{"telemetry": …}` of its log. */
interface LogLine {
  traceparent?: string;
  parent?: string;
  attributes?: Record<string, string | number | boolean>;
  error?: string;
  /** When what the span is of began and ended, in milliseconds since 1970, where the Worker ran on past it. */
  start?: number;
  end?: number;
  /** What the span is called, where it's of something else than the request: such a span is never routine. */
  name?: string;
}

/**
 * What's noise on its own, and kept only when it fails: iroh's relay and its pings, who's on, what servers ask the
 * presigner, a file such as a page's script, what a Durable Object does, and any call between Workers but the relay's
 * `forward`.
 */
const ROUTINE = /^\/(ping|relay|relay\/seen|presigner\/.*)$|\.[a-z0-9]+$/;
/** How long a minute's spans wait to be kept, in milliseconds. */
const EVERY = 60_000;
/** The most a minute keeps, in bytes: past it, the newest. */
const MOST = 2 * 1024 * 1024;

/** A request that reached none of the network's servers (`error`), or one that reached one, from `start` to `end`. */
interface Reach {
  start: number;
  end: number;
  error?: string;
}

/** A path as a route: what names a sharing link or a session in it isn't kept. */
const route = (path: string) => path.replace(/^\/(link|apps)\/.*/, "/$1/*");

/** The ids the next span is given: those the Worker carried on, so a server's span it reached is under it. */
const next: { trace?: string; span?: string } = {};
const random: IdGenerator = {
  generateTraceId: () => bytesToHex(randomBytes(16)),
  generateSpanId: () => bytesToHex(randomBytes(8)),
};
const ids: IdGenerator = {
  generateTraceId: () => next.trace ?? random.generateTraceId(),
  generateSpanId: () => next.span ?? random.generateSpanId(),
};

const exported = new InMemorySpanExporter();
const tracer = new TracerProvider({
  resource: resourceFromAttributes({ "service.name": "one-edge", "host.name": "edge" }),
  idGenerator: ids,
  spanProcessors: [new SimpleSpanProcessor({ exporter: exported })],
}).getTracer("telemetry");
const propagator = new W3CTraceContextPropagator();
const getter = { get: (carrier: Record<string, string>, key: string) => carrier[key], keys: (carrier: Record<string, string>) => Object.keys(carrier) };
/** A `traceparent`'s span as a context, or none. */
const under = (traceparent?: string): Context => (traceparent ? propagator.extract(ROOT_CONTEXT, { traceparent }, getter) : ROOT_CONTEXT);

/** Makes the span for one Worker's event, unless it's routine and went well, and gives whether it reached a server. */
function span(item: TraceItem): Reach | undefined {
  const event = item.event as (TraceItemFetchEventInfo & { rpcMethod?: string }) | null;
  const worker = (item.scriptName ?? "").replace(/^network-/, "");
  const request = event && "request" in event ? event.request : null;
  const path = request ? route(new URL(request.url).pathname) : null;
  const status = event && "response" in event ? event.response?.status : undefined;
  const record: LogLine = {};
  // `wrangler dev` says which Worker it was before what was logged.
  for (const text of item.logs.flatMap(({ message }) => message).filter((text) => typeof text === "string" && text.startsWith('{"telemetry"'))) {
    const line: LogLine = JSON.parse(text).telemetry;
    Object.assign(record, line, { attributes: { ...record.attributes, ...line.attributes } });
  }
  const upgraded = request?.headers.upgrade?.toLowerCase() === "websocket";
  // Cloudflare ends a WebSocket a Worker holds when it sheds load from a machine (`loadShed`, thrown in the Worker as
  // "internal error; reference = …"), as the relay's endpoints saw about six times an hour (18 Nov), and its endpoint
  // connects again at once, as iroh's does: that's Cloudflare's, not a failure.
  const thrown = upgraded && item.outcome === "loadShed" ? undefined : item.exceptions[0];
  const error =
    record.error ||
    (thrown && `${thrown.name}: ${thrown.message}`) ||
    // A WebSocket ends when either end leaves, a request when whoever sent it hangs up, as a browser that leaves the
    // page does, and a call between Workers when its caller does, as a client that disconnects mid-request: none is a
    // failure here, as OpenTelemetry has an HTTP server's span.
    (!upgraded && item.outcome !== "canceled" && item.outcome !== "ok" && `It ended ${item.outcome}`) ||
    (status !== undefined && status >= 500 && `It answered ${status}`) ||
    undefined;
  // As OpenTelemetry names an HTTP server's span, and a call between Workers by the Worker and its method.
  const name =
    record.name ?? (request ? `${request.method} ${path}` : event?.rpcMethod ? [worker, event.rpcMethod].filter(Boolean).join(" ") : record.traceparent ? worker : null);
  // What carried a trace on to a server, as the relay's Durable Object does as it passes a call on, is that trace's.
  const routine = !record.name && !record.traceparent && (item.executionModel === "durableObject" || (path ? ROUTINE.test(path) : event?.rpcMethod !== "forward"));
  // Cloudflare's times for a request that ended `unknown` aren't to be believed (one dated 9 days ahead): nothing here
  // ends after the Worker is told of it.
  const now = Date.now();
  const start = Math.min(record.start ?? item.eventTimestamp ?? now, now);
  const end = Math.min(record.end ?? start + ((item as { wallTime?: number }).wallTime ?? 0), now);
  // A call passed on says how many servers it tried (`one.servers`), and the one it reached, if any; a server says
  // whether it's ready as it says what it is.
  const a = record.attributes ?? {};
  const reach: Reach | undefined =
    a["one.server_ready"] === true || (a["one.servers"] !== undefined && a["one.server"] !== undefined)
      ? { start, end }
      : a["one.servers"] !== undefined && record.error
        ? { start, end, error: record.error }
        : undefined;
  if (!name || (!error && routine)) return reach;

  // Its own ids are those it carried on, and it's under the span it came in with where that's of the same trace.
  const own = trace.getSpanContext(under(record.traceparent));
  const parent = trace.getSpanContext(under(record.parent));
  Object.assign(next, { trace: own?.traceId, span: own?.spanId });
  const span = tracer.startSpan(
    name,
    {
      kind: SpanKind.SERVER,
      startTime: start,
      attributes: {
        ...(worker && { "one.worker": worker }),
        ...(request && { "http.request.method": request.method, "http.route": path! }),
        ...(status !== undefined && { "http.response.status_code": status }),
        ...record.attributes,
      },
    },
    own && parent?.traceId === own.traceId ? under(record.parent) : ROOT_CONTEXT,
  );
  delete next.trace, delete next.span;
  if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error.slice(0, 1000) });
  span.end(end);
  return reach;
}

/** The spans made since the last were taken, as an OTLP export request, if any. */
function taken() {
  const spans = exported.getFinishedSpans();
  exported.reset();
  // The serializer's bytes are a view of a buffer it uses again, so what's sent on is a copy of them.
  return spans.length ? ProtobufTraceSerializer.serializeRequest(spans)?.slice() : undefined;
}

export default {
  async tail(items: TraceItem[]) {
    const reached = items.map(span).filter((reach) => reach !== undefined);
    const otlp = taken();
    if (otlp || reached.length) await env.BATCH.get(env.BATCH.idFromName("edge")).add(otlp, reached);
  },
} satisfies ExportedHandler;

/** An outage: since when no server answered, until the last request none answered, how many and what the last said. */
interface Outage {
  start: number;
  end: number;
  requests: number;
  error: string;
}

/** A minute's spans, kept once it's over, and the outage there is, if any. */
export class Batch extends DurableObject {
  async add(otlp: Uint8Array | undefined, reached: Reach[] = []) {
    let outage = await this.ctx.storage.get<Outage>("outage");
    const was = outage;
    // By when each ended, as one Tail Worker's events may arrive after another's: a server that answered before the
    // last request none answered doesn't end the outage.
    for (const reach of reached.sort((a, b) => a.end - b.end)) {
      if (reach.error) outage = { start: outage?.start ?? reach.start, end: reach.end, requests: (outage?.requests ?? 0) + 1, error: reach.error };
      else if (outage && reach.end >= outage.end) {
        const span = tracer.startSpan("network unreachable", {
          kind: SpanKind.INTERNAL,
          startTime: outage.start,
          attributes: { "one.requests": outage.requests },
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: `None of the network's servers answered the edge, in ${outage.requests} requests: ${outage.error}`.slice(0, 1000) });
        span.end(reach.end);
        outage = undefined;
      }
    }
    const ended = taken();
    if (outage !== was) await (outage ? this.ctx.storage.put("outage", outage) : this.ctx.storage.delete("outage"));
    for (const kept of [otlp, ended]) {
      if (!kept) continue;
      if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + EVERY);
      await this.ctx.storage.put(`otlp/${Date.now()}/${bytesToHex(randomBytes(4))}`, kept);
    }
  }

  async alarm() {
    const listed = await this.ctx.storage.list<Uint8Array>({ prefix: "otlp/" });
    const exports = [...listed.values()].map((otlp) => new Uint8Array(otlp));
    let bytes = 0;
    const kept = exports.reverse().filter((otlp) => (bytes += otlp.length) <= MOST).reverse();
    const data = new Uint8Array(kept.reduce((sum, otlp) => sum + otlp.length, 0));
    kept.reduce((at, otlp) => (data.set(otlp, at), at + otlp.length), 0);
    const to = Date.now() * 1e6;
    const at = new Date(to / 1e6).toISOString();
    if (data.length) await env.OWN.write(`otlp/${at.slice(0, 10)}/${at.slice(11, 13)}/${to}-edge-${data.length}.traces`, data);
    // Only what was listed goes: what's added while it's written is the next minute's, with the alarm that adding
    // set. Storage deletes at most 128 keys a call.
    const keys = [...listed.keys()];
    for (let from = 0; from < keys.length; from += 128) await this.ctx.storage.delete(keys.slice(from, from + 128));
  }
}
