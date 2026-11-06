// The contract every data source implements: one request in the shapes of
// .orchestrate/api-contract.yaml. The app's one implementation is the HTTP API (api.service.ts);
// unit tests pass their own fake, which the domain services cannot tell apart from it.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type Query = Record<string, string | number | undefined>

export interface RequestOption {
  signal?: AbortSignal
  query?: Query
  // A raw body (a Blob, such as the profile photo) is sent as it is with this Content-Type;
  // any other body is sent as JSON.
  contentType?: string
  // `blob`: the response body is bytes (the profile photo), resolved as a Blob; `json` (default)
  // parses it as JSON.
  responseType?: 'json' | 'blob'
  // Plan 037: work the user did not start (the review status poll, the silent settings load):
  // not counted for the global loader.
  background?: boolean
}

export interface DataSource {
  // Resolves with the parsed response body (undefined for 204), or throws an AppError.
  request<T>(method: HttpMethod, url: string, body?: unknown, option?: RequestOption): Promise<T>
  // Cancels every shared request still in flight and forgets it (QA D1: on sign-out and when the
  // session ends, so the next account never joins the previous one's GET). Optional: a source
  // with nothing shared has nothing to cancel.
  abortAll?(): void
}

// One-line shortcuts over request.
export function get<T>(source: DataSource, url: string, option?: RequestOption): Promise<T> {
  return source.request<T>('GET', url, undefined, option)
}

export function post<T>(source: DataSource, url: string, body?: unknown, option?: RequestOption): Promise<T> {
  return source.request<T>('POST', url, body, option)
}

export function put<T>(source: DataSource, url: string, body?: unknown, option?: RequestOption): Promise<T> {
  return source.request<T>('PUT', url, body, option)
}

export function patch<T>(source: DataSource, url: string, body?: unknown, option?: RequestOption): Promise<T> {
  return source.request<T>('PATCH', url, body, option)
}

export function del<T = void>(source: DataSource, url: string, option?: RequestOption): Promise<T> {
  return source.request<T>('DELETE', url, undefined, option)
}
