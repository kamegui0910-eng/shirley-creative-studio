// Fetch wrapper: bearer auth, timeout, one retry for idempotent reads, and typed errors the UI can act on.

export class ApiError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // auth | forbidden | notfound | conflict | invalid | server | network | timeout | abort
    this.status = status;
  }
  get retryable() { return ['server', 'network', 'timeout'].includes(this.kind); }
}

const MESSAGES = {
  auth: '访问令牌无效或已过期，请重新登录',
  forbidden: '当前令牌没有权限执行此操作',
  notfound: '未找到请求的内容',
  conflict: '版本冲突：此配方已在别处更新',
  invalid: '请求内容无效',
  server: '服务暂时不可用，请稍后重试',
  network: '网络连接失败，请检查网络后重试',
  timeout: '请求超时，请重试'
};
const KIND_BY_STATUS = { 400: 'invalid', 401: 'auth', 403: 'forbidden', 404: 'notfound', 409: 'conflict' };

export function createApi({ getToken, fetchImpl = (...args) => globalThis.fetch(...args), timeoutMs = 15000, retryDelayMs = 400, onAuthFailure = () => {} }) {
  async function once(path, { method = 'GET', body, signal, headers = {} }) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetchImpl(path, {
        method, body, signal: controller.signal,
        headers: { ...headers, Authorization: 'Bearer ' + getToken() }
      });
      if (response.ok) return response;
      const kind = KIND_BY_STATUS[response.status] ?? (response.status >= 500 ? 'server' : 'invalid');
      throw new ApiError(kind, MESSAGES[kind], response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new ApiError('abort', '已取消');
      if (timedOut) throw new ApiError('timeout', MESSAGES.timeout);
      throw new ApiError('network', MESSAGES.network);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function request(path, options = {}) {
    const idempotent = (options.method ?? 'GET') === 'GET';
    try {
      return await once(path, options);
    } catch (error) {
      if (error.kind === 'auth') onAuthFailure(error);
      if (!idempotent || !error.retryable || options.signal?.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      try { return await once(path, options); } catch (second) {
        if (second.kind === 'auth') onAuthFailure(second);
        throw second;
      }
    }
  }

  return {
    request,
    json: async (path, options) => (await request(path, options)).json(),
    text: async (path, options) => (await request(path, options)).text(),
    blob: async (path, options) => (await request(path, options)).blob(),
    put: (path, value, options = {}) => request(path, { ...options, method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }).then(r => r.json())
  };
}
