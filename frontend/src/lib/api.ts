import axios from "axios";

const ACCESS_KEY = "russpeak_access";
const REFRESH_KEY = "russpeak_refresh";

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: "/api/v1" });

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, try a one-shot refresh, then replay the request.
let refreshing: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retried && tokenStore.refresh) {
      original._retried = true;
      try {
        if (!refreshing) {
          refreshing = axios
            .post("/api/v1/auth/refresh", { refresh_token: tokenStore.refresh })
            .then((r) => {
              tokenStore.set(r.data.access_token, r.data.refresh_token);
              return r.data.access_token as string;
            })
            .finally(() => {
              refreshing = null;
            });
        }
        const newToken = await refreshing;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        tokenStore.clear();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

// Upload bytes directly to a presigned S3/MinIO URL (bypasses the API).
export async function uploadToPresigned(url: string, blob: Blob, contentType: string) {
  await axios.put(url, blob, { headers: { "Content-Type": contentType } });
}
