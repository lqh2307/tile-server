import { Registry, Gauge, Counter, Histogram } from "prom-client";
import { StatusCodes } from "http-status-codes";

const register = new Registry();

const heapMemoryUsage = new Gauge({
  name: "heap_memory_usage",
  help: "Current heap memory usage in bytes",
});

setInterval(() => {
  heapMemoryUsage.set(process.memoryUsage().heapUsed);
}, 5000);

const httpRequestError = new Counter({
  name: "http_request_error",
  help: "Total number of HTTP request errors",
  labelNames: ["method", "protocol", "path", "status_code", "ip", "user_agent"],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration",
  help: "Duration of HTTP requests in ms",
  labelNames: ["method", "protocol", "path", "status_code", "ip", "user_agent"],
  buckets: [100, 300, 500, 1000],
});

register.setDefaultLabels({
  service_name: process.env.SERVICE_NAME,
});

register.registerMetric(heapMemoryUsage);
register.registerMetric(httpRequestError);
register.registerMetric(httpRequestDuration);

/**
 * Set metrics
 * @param {string} method HTTP method
 * @param {string} protocol HTTP protocol
 * @param {string} path HTTP path
 * @param {StatusCodes} statusCode HTTP status code
 * @param {string} origin Origin
 * @param {string} ip IP
 * @param {string} userAgent User agent
 * @returns {void}
 */
export function setMetrics(
  method,
  protocol,
  path,
  statusCode,
  origin,
  ip,
  userAgent
) {
  if (statusCode >= 400) {
    httpRequestError
      .labels(method, protocol, path, statusCode, origin, ip, userAgent)
      .inc();
  }

  httpRequestDuration
    .labels(method, protocol, path, statusCode, origin, ip, userAgent)
    .inc();
}

/**
 * Get metrics
 * @returns {Promise<object>}
 */
export async function getMetrics() {
  return {
    contentType: register.contentType,
    metrics: await register.metrics(),
  };
}
