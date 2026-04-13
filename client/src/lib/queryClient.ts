import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Intercept all fetch calls to inject auth header automatically
const originalFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const sessionId = localStorage.getItem('sessionId');
  if (sessionId) {
    init = init || {};
    const headers = new Headers(init.headers);
    if (!headers.has('x-session-id')) {
      headers.set('x-session-id', sessionId);
    }
    init.headers = headers;
  }
  return originalFetch.call(this, input, init);
};

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Get session ID from localStorage for authentication
  const sessionId = localStorage.getItem('sessionId');

  const headers: Record<string, string> = {};
  if (data) headers["Content-Type"] = "application/json";
  if (sessionId) headers["x-session-id"] = sessionId;

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const sessionId = localStorage.getItem('sessionId');
    const headers: Record<string, string> = {};
    if (sessionId) headers["x-session-id"] = sessionId;

    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
