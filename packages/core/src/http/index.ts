/**
 * `@quickben/core/http`: framework-agnostic HTTP helpers. `handleEndpointRequest` serves the
 * custom endpoints of a config from any server that speaks the Fetch API.
 */
export { readBytes } from "./body";
export { assertSameOrigin } from "./csrf";
export { handleEndpointRequest, normalizeBasePath } from "./endpoints";
export { errorResponse, HttpError, json } from "./errors";

export type { CsrfOptions } from "./csrf";
export type { EndpointRequestOptions } from "./endpoints";
export type { ErrorBody, HttpErrorCode } from "./errors";
